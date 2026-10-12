import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Command } from "commander";
import { VOICES, DEFAULT_VOICE, findVoice } from "../catalog/voices.ts";
import { DEFAULT_SOUNDFONT, soundfontsDir } from "../engines/fluidsynth.ts";
import { ENGINE_BINARY, enginePath, engineVersion, listEngineSingers } from "../engines/openutau.ts";
import { download } from "../lib/download.ts";
import { CliError, ExitCode } from "../lib/errors.ts";
import { exists } from "../lib/fsx.ts";
import { emit } from "../lib/output.ts";
import { cliHome, downloadsDir, engineDir, singersDir } from "../lib/paths.ts";
import { run, which } from "../lib/proc.ts";
import { step } from "../lib/progress.ts";
import { bold, danger, muted, ok, warn } from "../lib/style.ts";
import pkg from "../../package.json" with { type: "json" };
import { installCatalogVoice, isInstalled } from "./voice.ts";
import { installedSkillVersion, skillTarget } from "./skill.ts";

/** Engine binaries are published by this repo's engine workflow (engine/README.md). */
export const ENGINE_RELEASE = { repo: "Jibaru/vocaloid-cli", version: "0.1.0" };

function enginePlatform(): string | null {
  if (process.platform === "darwin" && process.arch === "arm64") return "osx-arm64";
  if (process.platform === "linux" && process.arch === "x64") return "linux-x64";
  return null;
}

type ActionStatus = "present" | "installed" | "missing" | "would-install" | "skipped" | "failed";
interface SetupAction {
  item: string;
  status: ActionStatus;
  bytes?: number;
  detail?: string;
  fix?: string;
}

async function installEngine(fromDir: string | undefined, dryRun: boolean): Promise<SetupAction> {
  if (await enginePath()) return { item: "engine", status: "present", detail: await engineVersion() };
  if (fromDir) {
    const src = resolve(fromDir);
    if (!(await exists(join(src, ENGINE_BINARY)))) {
      throw new CliError({ code: "ENGINE_NOT_FOUND", message: `${src} does not contain ${ENGINE_BINARY}` });
    }
    if (dryRun) return { item: "engine", status: "would-install", detail: `copy from ${src}` };
    await rm(engineDir(), { recursive: true, force: true });
    await mkdir(engineDir(), { recursive: true });
    await cp(src, engineDir(), { recursive: true });
    await writeFile(join(engineDir(), "VERSION"), "local-build\n");
    return { item: "engine", status: "installed", detail: `copied from ${src}` };
  }
  const platform = enginePlatform();
  if (!platform) {
    return { item: "engine", status: "missing", detail: `no prebuilt engine for ${process.platform}-${process.arch}`, fix: "Build OpenUtau.Cli from Jibaru/openutau-headless and run `vocaloid setup --engine-from <publish dir>`" };
  }
  const asset = `openutau-cli-${platform}.tar.gz`;
  const url = `https://github.com/${ENGINE_RELEASE.repo}/releases/download/engine-v${ENGINE_RELEASE.version}/${asset}`;
  if (dryRun) return { item: "engine", status: "would-install", detail: url };
  const archive = join(downloadsDir(), asset);
  try {
    const sum = await fetch(`${url}.sha256`);
    if (!sum.ok) throw new Error(`HTTP ${sum.status}`);
    const sha = (await sum.text()).trim().split(/\s+/)[0];
    await download(url, archive, { task: "Downloading engine", sha256: sha });
  } catch (e) {
    return { item: "engine", status: "failed", detail: `release ${ENGINE_RELEASE.version} unavailable (${e instanceof Error ? e.message : e})`, fix: "Build it locally and run `vocaloid setup --engine-from <publish dir>`" };
  }
  await rm(engineDir(), { recursive: true, force: true });
  await mkdir(engineDir(), { recursive: true });
  const r = await run("tar", ["-xzf", archive, "-C", engineDir()]);
  if (r.code !== 0) return { item: "engine", status: "failed", detail: r.stderr.trim() };
  await writeFile(join(engineDir(), "VERSION"), `${ENGINE_RELEASE.version}\n`);
  return { item: "engine", status: "installed", detail: ENGINE_RELEASE.version };
}

async function systemTool(name: string, pkg: { brew: string; apt: string }, install: boolean, dryRun: boolean): Promise<SetupAction> {
  if (await which(name)) return { item: name, status: "present" };
  const brew = process.platform === "darwin" ? await which("brew") : null;
  const fix = brew ? `brew install ${pkg.brew}` : `sudo apt install ${pkg.apt}`;
  if (!install || !brew) return { item: name, status: "missing", fix };
  if (dryRun) return { item: name, status: "would-install", detail: fix };
  step(name, `installing with Homebrew (${fix})…`);
  const r = await run(brew, ["install", pkg.brew]);
  return r.code === 0 && (await which(name))
    ? { item: name, status: "installed", detail: fix }
    : { item: name, status: "failed", detail: r.stderr.trim().slice(-300), fix };
}

async function installSoundfont(dryRun: boolean): Promise<SetupAction> {
  const path = join(soundfontsDir(), DEFAULT_SOUNDFONT.file);
  if (await exists(path)) return { item: "soundfont", status: "present", detail: DEFAULT_SOUNDFONT.name };
  if (dryRun) return { item: "soundfont", status: "would-install", bytes: DEFAULT_SOUNDFONT.bytes, detail: DEFAULT_SOUNDFONT.name };
  await download(DEFAULT_SOUNDFONT.url, path, { task: "Downloading soundfont", sha256: DEFAULT_SOUNDFONT.sha256, expectedBytes: DEFAULT_SOUNDFONT.bytes });
  return { item: "soundfont", status: "installed", bytes: DEFAULT_SOUNDFONT.bytes, detail: DEFAULT_SOUNDFONT.name };
}

async function installDefaultVoice(dryRun: boolean): Promise<SetupAction> {
  const v = findVoice(DEFAULT_VOICE)!;
  const voice = { ...v, source: "catalog" as const };
  if (await isInstalled(voice)) return { item: `voice:${v.id}`, status: "present" };
  if (dryRun) return { item: `voice:${v.id}`, status: "would-install", bytes: v.download.bytes, detail: v.name };
  await installCatalogVoice(v, {});
  return { item: `voice:${v.id}`, status: "installed", bytes: v.download.bytes, detail: v.name };
}

function statusLabel(s: ActionStatus): string {
  switch (s) {
    case "present":
    case "installed":
      return ok(s);
    case "would-install":
    case "skipped":
      return warn(s);
    default:
      return danger(s);
  }
}

export function registerSetup(program: Command): void {
  program
    .command("setup")
    .description("Install everything render needs: engine, ffmpeg, fluidsynth, soundfont and the default voice (idempotent)")
    .option("--engine-from <dir>", "install the engine from a local OpenUtau.Cli publish directory")
    .option("--install-deps", "install missing ffmpeg/fluidsynth with Homebrew (macOS)")
    .option("--no-voice", "skip the default voice download (~550 MB)")
    .option("--dry-run", "list what would be installed and how much would be downloaded")
    .action(async (opts: { engineFrom?: string; installDeps?: boolean; voice: boolean; dryRun?: boolean }) => {
      const dry = Boolean(opts.dryRun);
      const actions: SetupAction[] = [];
      actions.push(await installEngine(opts.engineFrom, dry));
      actions.push(await systemTool("ffmpeg", { brew: "ffmpeg", apt: "ffmpeg" }, Boolean(opts.installDeps), dry));
      actions.push(await systemTool("fluidsynth", { brew: "fluid-synth", apt: "fluidsynth" }, Boolean(opts.installDeps), dry));
      actions.push(await installSoundfont(dry));
      actions.push(opts.voice ? await installDefaultVoice(dry) : { item: `voice:${DEFAULT_VOICE}`, status: "skipped" });
      const pending = actions.filter((a) => a.status === "missing" || a.status === "failed");
      const bytes = actions.filter((a) => a.status === "would-install").reduce((n, a) => n + (a.bytes ?? 0), 0);
      emit({
        data: { home: cliHome(), dryRun: dry, ready: pending.length === 0 && !dry, downloadBytes: bytes, actions },
        human: (d) =>
          [
            ...d.actions.map((a) => `${statusLabel(a.status).padEnd(24)} ${bold(a.item)} ${muted(a.detail ?? "")}${a.fix ? `\n${" ".repeat(10)}${muted(`fix: ${a.fix}`)}` : ""}`),
            d.dryRun ? `\n${warn("dry run")} would download ${(d.downloadBytes / 1e6).toFixed(0)} MB` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        nextSteps: pending.length
          ? pending.map((p) => p.fix).filter((f): f is string => Boolean(f))
          : dry
            ? ["vocaloid setup"]
            : ["vocaloid doctor", "vocaloid init my-song"],
      });
    });

  program
    .command("doctor")
    .description("Check the render environment; every failing check carries the command that fixes it")
    .action(async () => {
      const checks: { name: string; ok: boolean; detail: string; fix?: string; required: boolean }[] = [];
      const major = Number(process.versions.node.split(".")[0]);
      checks.push({ name: "node", ok: major >= 20, detail: process.versions.node, fix: "Install Node.js 20 or newer", required: true });
      const engine = await enginePath();
      let singers: string[] = [];
      if (engine) {
        try {
          singers = (await listEngineSingers()).map((s) => s.Id);
          checks.push({ name: "engine", ok: true, detail: `${engine} (${await engineVersion()})`, required: true });
        } catch (e) {
          checks.push({ name: "engine", ok: false, detail: e instanceof Error ? e.message : String(e), fix: "vocaloid setup", required: true });
        }
      } else {
        checks.push({ name: "engine", ok: false, detail: "not installed", fix: "vocaloid setup", required: true });
      }
      const ffmpeg = await which("ffmpeg");
      checks.push({ name: "ffmpeg", ok: Boolean(ffmpeg), detail: ffmpeg ?? "not found", fix: "vocaloid setup --install-deps", required: true });
      const fluid = await which("fluidsynth");
      checks.push({ name: "fluidsynth", ok: Boolean(fluid), detail: fluid ?? "not found (needed for instrument tracks)", fix: "vocaloid setup --install-deps", required: false });
      const sf = await exists(join(soundfontsDir(), DEFAULT_SOUNDFONT.file));
      checks.push({ name: "soundfont", ok: sf, detail: sf ? DEFAULT_SOUNDFONT.name : "not installed (needed for instrument tracks)", fix: "vocaloid setup", required: false });
      for (const v of VOICES) {
        const installed = await exists(join(singersDir(), v.download.folder));
        const loaded = singers.includes(v.singerId);
        checks.push({
          name: `voice:${v.id}`,
          ok: installed && (!engine || loaded),
          detail: !installed ? "not installed" : engine && !loaded ? "on disk but the engine did not load it" : "installed",
          fix: `vocaloid voice install ${v.id}`,
          required: v.id === DEFAULT_VOICE,
        });
      }
      const skillVersion = await installedSkillVersion(skillTarget("claude", "user"));
      checks.push({
        name: "skill",
        ok: skillVersion === pkg.version,
        detail: skillVersion === null ? "agent skill not installed (~/.claude/skills/vocaloid)" : `v${skillVersion}${skillVersion === pkg.version ? "" : `, CLI is v${pkg.version}`}`,
        fix: "vocaloid skill install",
        required: false,
      });
      const healthy = checks.every((c) => c.ok || !c.required);
      emit({
        data: { healthy, home: cliHome(), checks },
        human: (d) =>
          d.checks
            .map((c) => `${c.ok ? ok("✓") : c.required ? danger("✗") : warn("!")} ${bold(c.name.padEnd(14))} ${muted(c.detail)}${c.ok ? "" : `\n  ${muted(`fix: ${c.fix}`)}`}`)
            .join("\n"),
        nextSteps: [...new Set(checks.filter((c) => !c.ok).map((c) => c.fix!))],
      });
      if (!healthy) process.exitCode = ExitCode.missingDependency;
    });
}
