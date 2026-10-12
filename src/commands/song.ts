import { join, relative, resolve } from "node:path";
import type { Command } from "commander";
import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { stringify } from "yaml";
import { DEFAULT_SINGER, type VocaloidSinger, allSingers } from "../catalog/singers.ts";
import { DEFAULT_VOICE } from "../catalog/voices.ts";
import { type ImportFormat, importProject } from "../formats/import.ts";
import { toMidi } from "../formats/midi.ts";
import { toVpr } from "../formats/vpr.ts";
import { toVsqx } from "../formats/vsqx.ts";
import { exists } from "../lib/fsx.ts";
import { SONG_FILE } from "../lib/paths.ts";
import { parseSongText } from "../model/io.ts";
import type { CompiledVocalTrack } from "../model/compile.ts";
import { toUstx } from "../formats/ustx.ts";
import { CliError, ExitCode } from "../lib/errors.ts";
import { writeAtomic } from "../lib/fsx.ts";
import { emit, success } from "../lib/output.ts";
import { BUILD_DIR } from "../lib/paths.ts";
import { bold, dim, info, muted, table } from "../lib/style.ts";
import type { CompiledSong } from "../model/compile.ts";
import { loadSong } from "../model/io.ts";
import { pitchName, tickToSeconds } from "../model/music.ts";

export function summarize(song: CompiledSong) {
  const seconds = tickToSeconds(song.endTick, song.tempos);
  return {
    title: song.title,
    artist: song.artist ?? null,
    key: song.key ?? null,
    tempo: song.tempos.map((t) => ({ at: song.grid.label(t.tick), bpm: t.bpm })),
    timeSignatures: song.timeSignatures.map((s) => ({ bar: s.bar, sig: `${s.numerator}/${s.denominator}` })),
    bars: song.endTick === 0 ? 0 : Number(song.grid.label(Math.max(0, song.endTick - 1)).split(":")[0]),
    durationSeconds: Number(seconds.toFixed(2)),
    sections: song.sections.map((s) => ({ name: s.name, at: song.grid.label(s.tick) })),
    tracks: song.tracks.map((t) => {
      const pitches = t.notes.map((n) => n.midi);
      const base = {
        id: t.id,
        kind: t.kind,
        notes: t.notes.length,
        // A pitch range means nothing for drums (notes are drum kit pieces).
        range:
          pitches.length && !(t.kind === "instrument" && t.program === "drums")
            ? `${pitchName(Math.min(...pitches))}-${pitchName(Math.max(...pitches))}`
            : null,
        start: t.notes[0] ? song.grid.label(t.notes[0].tick) : null,
        volume: t.volume,
        pan: t.pan,
        mute: t.mute,
      };
      return t.kind === "vocal"
        ? {
            ...base,
            voice: t.voice.id,
            language: t.language,
            lyrics: t.notes.map((n) => n.lyric).join(" "),
            curves: Object.keys(t.curves),
          }
        : { ...base, instrument: t.instrument, generated: t.generated ?? null };
    }),
  };
}

type Summary = ReturnType<typeof summarize>;

function renderSummary(s: Summary): string {
  const mins = Math.floor(s.durationSeconds / 60);
  const secs = Math.round(s.durationSeconds % 60).toString().padStart(2, "0");
  const tempo = s.tempo.map((t) => `${t.bpm}`).join(" → ");
  const head = [
    bold(s.title) + (s.artist ? dim(` — ${s.artist}`) : ""),
    `${muted("tempo")} ${tempo} bpm  ${muted("time")} ${s.timeSignatures.map((t) => t.sig).join(" → ")}  ${muted("key")} ${s.key ?? "—"}  ${muted("length")} ${mins}:${secs} (${s.bars} bars)`,
  ];
  if (s.sections.length) head.push(`${muted("sections")} ${s.sections.map((x) => `${x.name}@${x.at}`).join("  ")}`);
  const rows = table(s.tracks, [
    { header: "track", get: (t) => bold(t.id) },
    { header: "kind", get: (t) => t.kind },
    { header: "sound", get: (t) => ("voice" in t ? `${t.voice} (${t.language})` : `${t.instrument}${"generated" in t && t.generated ? muted(` ← ${t.generated.part}`) : ""}`) },
    { header: "notes", get: (t) => String(t.notes), align: "right" },
    { header: "range", get: (t) => t.range ?? muted("—") },
    { header: "starts", get: (t) => t.start ?? muted("—") },
    { header: "mix", get: (t) => (t.mute ? muted("muted") : `${t.volume >= 0 ? "+" : ""}${t.volume} dB ${t.pan === 0 ? "C" : t.pan < 0 ? `L${-t.pan}` : `R${t.pan}`}`) },
  ]);
  const lyrics = s.tracks
    .filter((t): t is Extract<Summary["tracks"][number], { lyrics: string }> => "lyrics" in t && t.lyrics.length > 0)
    .map((t) => `${info(t.id)} ${dim(t.lyrics.length > 160 ? `${t.lyrics.slice(0, 160)}…` : t.lyrics)}`);
  return [...head, "", rows, ...(lyrics.length ? ["", ...lyrics] : [])].join("\n");
}

export function registerSong(program: Command): void {
  const song = program.command("song").description("Validate, inspect, export and import songs");

  song
    .command("validate")
    .description("Check song.yaml against the schema and musical rules; lists every problem with its path")
    .argument("[dir]", "song directory or song.yaml", ".")
    .action(async (dir: string) => {
      const loaded = await loadSong(dir);
      emit({
        data: { valid: true, file: loaded.file, warnings: loaded.warnings },
        warnings: loaded.warnings,
        human: (d) => success(`${d.file} is valid`),
        nextSteps: [`vocaloid render ${dir}`],
      });
    });

  song
    .command("inspect")
    .description("Summarize a song: tempo, length, sections, tracks, ranges and lyrics")
    .argument("[dir]", "song directory or song.yaml", ".")
    .action(async (dir: string) => {
      const loaded = await loadSong(dir);
      emit({
        data: summarize(loaded.compiled),
        warnings: loaded.warnings,
        human: renderSummary,
        nextSteps: [`vocaloid note list ${dir} --track <id>`, `vocaloid render ${dir}`],
      });
    });

  song
    .command("export")
    .description("Write the song in another format: vpr (VOCALOID5/6), vsqx (VOCALOID4), ustx (OpenUtau), mid (MIDI)")
    .argument("[dir]", "song directory or song.yaml", ".")
    .requiredOption("--format <format>", "vpr | vsqx | ustx | mid")
    .option("--singer <spec>", 'VOCALOID singer for vpr/vsqx: an id from `vocaloid singer list`, or per track "lead=miku-v6,harmony=vy2v3"')
    .option("--out <file>", "output path (default: build/<title>.<ext>)")
    .option("--track <ids>", "comma-separated track ids to include (default: all)")
    .action(async (dir: string, opts: { format: string; out?: string; track?: string; singer?: string }) => {
      const loaded = await loadSong(dir);
      const trackIds = opts.track?.split(",").map((s) => s.trim());
      for (const id of trackIds ?? []) {
        if (!loaded.compiled.tracks.some((t) => t.id === id)) {
          throw new CliError({ code: "TRACK_NOT_FOUND", message: `No track "${id}"`, hint: `vocaloid song inspect ${dir}` });
        }
      }
      const safe = loaded.compiled.title.replace(/[^\p{L}\p{N}._-]+/gu, "_");
      let content: string | Uint8Array;
      let ext: string;
      const warnings: string[] = [];
      switch (opts.format) {
        case "ustx":
          content = toUstx(loaded.compiled, { trackIds });
          ext = "ustx";
          break;
        case "mid":
        case "midi":
          content = toMidi(loaded.compiled, { trackIds });
          ext = "mid";
          break;
        case "vpr":
        case "vsqx": {
          const singerFor = await singerResolver(opts.singer, warnings);
          const selected = trackIds ? { ...loaded.compiled, tracks: loaded.compiled.tracks.filter((t) => trackIds.includes(t.id)) } : loaded.compiled;
          if (opts.format === "vpr") {
            const r = toVpr(selected, { singerFor });
            content = r.bytes;
            warnings.push(...r.warnings);
          } else {
            const r = toVsqx(selected, { singerFor });
            content = r.text;
            warnings.push(...r.warnings);
          }
          ext = opts.format;
          break;
        }
        default:
          throw new CliError({ code: "UNKNOWN_FORMAT", message: `Unknown format "${opts.format}"`, hint: "Supported: vpr, vsqx, ustx, mid" });
      }
      const out = resolve(opts.out ?? join(loaded.dir, BUILD_DIR, `${safe}.${ext}`));
      await writeAtomic(out, content);
      emit({
        data: { format: ext, file: out, bytes: content.length, warnings },
        warnings,
        human: (d) => success(`Wrote ${bold(relative(process.cwd(), d.file))} ${muted(`${d.bytes} bytes`)}`),
      });
    });

  song
    .command("import")
    .description("Create a song directory from a VOCALOID (.vpr, .vsqx) or OpenUtau (.ustx) project")
    .argument("<file>", "project file to import")
    .requiredOption("--out <dir>", "song directory to create")
    .option("--voice <id>", "voice for the imported vocal tracks", DEFAULT_VOICE)
    .option("--force", "overwrite an existing song.yaml")
    .action(async (file: string, opts: { out: string; voice: string; force?: boolean }) => {
      const ext = extname(file).slice(1).toLowerCase();
      if (!["vpr", "vsqx", "ustx"].includes(ext)) {
        throw new CliError({ code: "UNKNOWN_FORMAT", message: `Cannot import .${ext}`, hint: "Supported: .vpr, .vsqx, .ustx" });
      }
      const target = join(resolve(opts.out), SONG_FILE);
      if ((await exists(target)) && !opts.force) throw new CliError({ code: "SONG_EXISTS", message: `${target} already exists`, hint: "Use --force" });
      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(await readFile(file));
      } catch {
        throw new CliError({ code: "FILE_NOT_FOUND", message: `Cannot read ${file}` });
      }
      let result;
      try {
        result = importProject(ext as ImportFormat, bytes, { title: basename(file, `.${ext}`), voice: opts.voice });
      } catch (e) {
        throw new CliError({ code: "IMPORT_FAILED", message: e instanceof Error ? e.message : String(e), exitCode: ExitCode.invalidSong });
      }
      const text = `# Imported from ${basename(file)} by vocaloid-cli\n${stringify(result.song, { lineWidth: 0, flowCollectionPadding: true })}`;
      parseSongText(text, target);
      await writeAtomic(target, text);
      const loaded = await loadSong(opts.out);
      emit({
        data: { file: target, source: resolve(file), tracks: loaded.compiled.tracks.map((t) => ({ id: t.id, notes: t.notes.length })), warnings: [...result.warnings, ...loaded.warnings] },
        warnings: [...result.warnings, ...loaded.warnings],
        human: (d) => `${success(`Imported ${bold(basename(file))} → ${d.file}`)}\n${d.tracks.map((t) => `  ${t.id} ${muted(`${t.notes} notes`)}`).join("\n")}`,
        nextSteps: [`vocaloid song inspect ${opts.out}`, `vocaloid render ${opts.out}`],
      });
    });
}


/** "--singer miku" for every track, or "lead=miku,harmony=vy2v3" per track. */
async function singerResolver(spec: string | undefined, warnings: string[]): Promise<(t: CompiledVocalTrack) => VocaloidSinger> {
  const singers = await allSingers();
  const find = (key: string) => {
    const s = singers.find((x) => x.id === key || x.compID === key);
    if (!s) throw new CliError({ code: "SINGER_NOT_FOUND", message: `No VOCALOID singer "${key}"`, hint: "vocaloid singer list (add yours with `vocaloid singer import <file.vpr>`)" });
    return s;
  };
  if (!spec) {
    const fallback = find(DEFAULT_SINGER);
    warnings.push(`No --singer given: exported with ${fallback.name}. Pass --singer (see \`vocaloid singer list\`) to use your voicebank`);
    return () => fallback;
  }
  if (!spec.includes("=")) {
    const s = find(spec);
    return () => s;
  }
  const map = new Map(spec.split(",").map((pair) => {
    const [track, id] = pair.split("=").map((x) => x.trim());
    return [track!, find(id!)] as const;
  }));
  const fallback = find(DEFAULT_SINGER);
  return (t) => {
    const s = map.get(t.id);
    if (!s) warnings.push(`track "${t.id}" has no singer in --singer; using ${fallback.name}`);
    return s ?? fallback;
  };
}
