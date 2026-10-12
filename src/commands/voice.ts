import { mkdir, readFile, rm, symlink } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import type { Command } from "commander";
import { parse as parseYaml } from "yaml";
import { type LocalVoice, type Voice, allVoices, readLocalVoices, resolveVoice, writeLocalVoices } from "../catalog/registry.ts";
import type { CatalogVoice, Language } from "../catalog/voices.ts";
import { download, resolveMediafire } from "../lib/download.ts";
import { CliError, ExitCode } from "../lib/errors.ts";
import { exists, sha256File } from "../lib/fsx.ts";
import { emit, success } from "../lib/output.ts";
import { downloadsDir, singersDir } from "../lib/paths.ts";
import { run } from "../lib/proc.ts";
import { step } from "../lib/progress.ts";
import { bold, dim, muted, ok, table, warn } from "../lib/style.ts";

export async function isInstalled(voice: Voice): Promise<boolean> {
  const folder = voice.source === "catalog" ? voice.download.folder : voice.singerId;
  return exists(join(singersDir(), folder));
}

function describe(voice: Voice, installed: boolean) {
  return {
    id: voice.id,
    name: voice.name,
    source: voice.source,
    type: voice.type,
    installed,
    languages: Object.keys(voice.phonemizers),
    voiceColors: voice.voiceColors,
    commercial: voice.license.commercial,
    credit: voice.license.credit,
    licenseSummary: voice.license.summary,
    timbre: voice.source === "catalog" ? voice.timbre : null,
    downloadBytes: voice.source === "catalog" ? voice.download.bytes : null,
  };
}

export async function installCatalogVoice(voice: CatalogVoice, opts: { fromZip?: string }): Promise<{ path: string; downloaded: boolean }> {
  const target = join(singersDir(), voice.download.folder);
  if (await exists(target)) return { path: target, downloaded: false };
  const zip = opts.fromZip ? resolve(opts.fromZip) : join(downloadsDir(), `${voice.id}.zip`);
  let downloaded = false;
  if (opts.fromZip) {
    const actual = await sha256File(zip);
    if (actual !== voice.download.sha256) {
      throw new CliError({
        code: "CHECKSUM_MISMATCH",
        message: `${zip} has sha256 ${actual}, expected ${voice.download.sha256}`,
        hint: "Make sure it is the exact file from the original download link",
        exitCode: ExitCode.missingDependency,
      });
    }
  } else {
    const url = voice.download.kind === "mediafire" ? await resolveMediafire(voice.download.url) : voice.download.url;
    await download(url, zip, { task: `Downloading ${voice.id}`, sha256: voice.download.sha256, expectedBytes: voice.download.bytes });
    downloaded = true;
  }
  step(voice.id, "extracting…");
  const staging = join(downloadsDir(), `${voice.id}-extract`);
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  const r = await run("unzip", ["-q", "-o", zip, "-d", staging]);
  if (r.code !== 0) {
    throw new CliError({ code: "EXTRACT_FAILED", message: r.stderr.trim().slice(0, 500), hint: "Is `unzip` installed?", exitCode: ExitCode.missingDependency });
  }
  if (!(await exists(join(staging, voice.download.folder)))) {
    throw new CliError({ code: "EXTRACT_FAILED", message: `Archive does not contain "${voice.download.folder}"`, exitCode: ExitCode.missingDependency });
  }
  await mkdir(singersDir(), { recursive: true });
  await run("mv", [join(staging, voice.download.folder), target]);
  await rm(staging, { recursive: true, force: true });
  return { path: target, downloaded };
}

export function registerVoice(program: Command): void {
  const voice = program.command("voice").description("Browse, install and add singing voices");

  voice
    .command("list")
    .description("List catalog and local voices with license, languages and install state")
    .action(async () => {
      const voices = await allVoices();
      const rows = await Promise.all(voices.map(async (v) => describe(v, await isInstalled(v))));
      emit({
        data: rows,
        human: (d) =>
          table(d, [
            { header: "id", get: (v) => bold(v.id) },
            { header: "name", get: (v) => v.name },
            { header: "languages", get: (v) => v.languages.join(" ") },
            { header: "commercial", get: (v) => (v.commercial ? ok("yes") : warn("no")) },
            { header: "state", get: (v) => (v.installed ? ok("installed") : muted(v.downloadBytes ? `${(v.downloadBytes / 1e6).toFixed(0)} MB` : "missing")) },
          ]),
        nextSteps: rows.filter((r) => !r.installed).map((r) => `vocaloid voice install ${r.id}`),
      });
    });

  voice
    .command("show")
    .description("Show one voice: license terms, languages, voice colors, credit line")
    .argument("<id>")
    .action(async (id: string) => {
      const v = await resolveVoice(id);
      if (!v) throw new CliError({ code: "VOICE_NOT_FOUND", message: `No voice "${id}"`, hint: "vocaloid voice list" });
      const d = { ...describe(v, await isInstalled(v)), phonemizers: v.phonemizers, termsUrl: v.source === "catalog" ? v.license.termsUrl : null };
      emit({
        data: d,
        human: (x) =>
          [
            bold(x.name) + dim(` (${x.id})`),
            x.timbre ? x.timbre : "",
            `${muted("languages")} ${x.languages.join(", ")}   ${muted("voice colors")} ${x.voiceColors.join(", ") || "—"}`,
            `${muted("commercial")} ${x.commercial ? ok("allowed") : warn("not allowed")}   ${muted("installed")} ${x.installed ? ok("yes") : warn("no")}`,
            `${muted("license")} ${x.licenseSummary}`,
            `${muted("credit")} ${x.credit}`,
            x.termsUrl ? `${muted("terms")} ${x.termsUrl}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        nextSteps: d.installed ? [] : [`vocaloid voice install ${id}`],
      });
    });

  voice
    .command("install")
    .description("Download and install a catalog voice from its original source (checksum verified)")
    .argument("<id>")
    .option("--from-zip <file>", "install from an already downloaded archive instead")
    .option("--dry-run", "show what would be downloaded without doing it")
    .action(async (id: string, opts: { fromZip?: string; dryRun?: boolean }) => {
      const v = await resolveVoice(id);
      if (!v) throw new CliError({ code: "VOICE_NOT_FOUND", message: `No voice "${id}"`, hint: "vocaloid voice list" });
      if (v.source !== "catalog") throw new CliError({ code: "NOT_A_CATALOG_VOICE", message: `"${id}" is a local voice; it is already on disk` });
      const installed = await isInstalled(v);
      if (opts.dryRun || installed) {
        emit({
          data: { id, installed, dryRun: Boolean(opts.dryRun), wouldDownloadBytes: installed ? 0 : v.download.bytes, source: v.download.url, license: v.license.summary },
          human: (d) =>
            d.installed
              ? success(`${id} is already installed`)
              : `${warn("dry run")} would download ${bold(`${(d.wouldDownloadBytes / 1e6).toFixed(0)} MB`)} from ${d.source}\n${muted(d.license)}`,
          nextSteps: installed ? [] : [`vocaloid voice install ${id}`],
        });
        return;
      }
      const result = await installCatalogVoice(v, { fromZip: opts.fromZip });
      emit({
        data: { id, installed: true, path: result.path, downloaded: result.downloaded, credit: v.license.credit },
        human: (d) => `${success(`Installed ${bold(v.name)}`)}\n${muted(`credit: ${d.credit}`)}`,
        nextSteps: ["vocaloid doctor", "vocaloid init my-song"],
      });
    });

  voice
    .command("add")
    .description("Register a voicebank folder you already have (OpenUtau/UTAU/DiffSinger format)")
    .requiredOption("--path <dir>", "voicebank folder (contains character.yaml or character.txt)")
    .requiredOption("--id <id>", "slug to use in song.yaml")
    .option("--language <lang=phonemizer>", 'language and OpenUtau phonemizer, e.g. "ja=OpenUtau.Plugin.Builtin.JapaneseVCVPhonemizer"; repeatable', collect, [])
    .requiredOption("--credit <text>", "credit line required by the voicebank's terms")
    .option("--commercial", "the voicebank's terms allow commercial use")
    .option("--license-summary <text>", "short summary of the terms", "See the voicebank's readme")
    .action(async (opts: { path: string; id: string; language: string[]; credit: string; commercial?: boolean; licenseSummary: string }) => {
      if (!/^[a-z0-9][a-z0-9-]*$/.test(opts.id)) throw new CliError({ code: "INVALID_ARGUMENT", message: "--id must be a lowercase slug" });
      if (await resolveVoice(opts.id)) throw new CliError({ code: "VOICE_EXISTS", message: `A voice "${opts.id}" already exists` });
      const src = resolve(opts.path);
      const charYaml = join(src, "character.yaml");
      const charTxt = join(src, "character.txt");
      if (!(await exists(charYaml)) && !(await exists(charTxt))) {
        throw new CliError({ code: "NOT_A_VOICEBANK", message: `${src} has no character.yaml or character.txt` });
      }
      const meta = (await exists(charYaml)) ? ((parseYaml(await readFile(charYaml, "utf8")) ?? {}) as Record<string, unknown>) : {};
      if (opts.language.length === 0) throw new CliError({ code: "MISSING_ARGUMENT", message: "At least one --language lang=Phonemizer is required" });
      const phonemizers: Partial<Record<Language, string>> = {};
      for (const pair of opts.language) {
        const [lang, cls] = pair.split("=");
        if (!lang || !cls) throw new CliError({ code: "INVALID_ARGUMENT", message: `--language "${pair}" must look like ja=Some.Phonemizer` });
        phonemizers[lang as Language] = cls;
      }
      const subbanks = (meta.subbanks as { color?: string }[] | undefined) ?? [];
      const colors = [...new Set(subbanks.map((s) => s.color).filter((c): c is string => Boolean(c)))];
      const folder = basename(src);
      await mkdir(singersDir(), { recursive: true });
      const link = join(singersDir(), folder);
      if (!(await exists(link))) await symlink(src, link, "dir");
      const entry: LocalVoice = {
        id: opts.id,
        name: String(meta.name ?? folder),
        type: meta.singer_type === "diffsinger" ? "diffsinger" : "utau",
        singerId: folder,
        phonemizers,
        voiceColors: colors,
        license: { commercial: Boolean(opts.commercial), credit: opts.credit, summary: opts.licenseSummary },
      };
      await writeLocalVoices([...(await readLocalVoices()), entry]);
      emit({
        data: entry,
        human: (d) => success(`Added ${bold(d.id)} → ${link}`),
        nextSteps: [`vocaloid voice show ${opts.id}`],
      });
    });
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}
