import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type { Command } from "commander";
import { type Stem, mixStems, probeDuration, requireFfmpeg } from "../engines/ffmpeg.ts";
import { EnginePhonemizationError, engineVersion, renderUstx, requireEngine } from "../engines/openutau.ts";
import { toMidi } from "../formats/midi.ts";
import { toUstx } from "../formats/ustx.ts";
import { CliError, type ErrorDetail, ExitCode } from "../lib/errors.ts";
import { exists, sha256, writeAtomic } from "../lib/fsx.ts";
import { emit, success } from "../lib/output.ts";
import { BUILD_DIR, singersDir } from "../lib/paths.ts";
import { progress, step } from "../lib/progress.ts";
import { bold, muted } from "../lib/style.ts";
import type { CompiledSong, CompiledVocalTrack } from "../model/compile.ts";
import { loadSong } from "../model/io.ts";
import { tickToSeconds } from "../model/music.ts";
import { renderInstrumentStem } from "./instruments.ts";
import { DEFAULT_SOUNDFONT } from "../engines/fluidsynth.ts";

export interface RenderOptions {
  only?: string;
  mp3: boolean;
  loudness: string;
  commercial?: boolean;
}

async function ensureVoicesInstalled(song: CompiledSong): Promise<void> {
  const missing: ErrorDetail[] = [];
  for (const t of song.tracks) {
    if (t.kind !== "vocal" || t.mute || t.notes.length === 0) continue;
    const folder = t.voice.source === "catalog" ? t.voice.download.folder : t.voice.singerId;
    if (!(await exists(join(singersDir(), folder)))) {
      missing.push({ path: `tracks[${t.index}].voice`, message: `Voice "${t.voice.id}" is not installed`, voice: t.voice.id });
    }
  }
  if (missing.length) {
    const ids = [...new Set(missing.map((m) => m.voice as string))];
    throw new CliError({
      code: "VOICE_NOT_INSTALLED",
      message: `Missing voice(s): ${ids.join(", ")}`,
      hint: ids.map((id) => `vocaloid voice install ${id}`).join(" && "),
      details: missing,
      exitCode: ExitCode.missingDependency,
    });
  }
}

function checkLicenses(song: CompiledSong, commercial: boolean): string[] {
  const credits = new Set<string>();
  const blocked: ErrorDetail[] = [];
  for (const t of song.tracks) {
    if (t.kind !== "vocal" || t.mute) continue;
    credits.add(t.voice.license.credit);
    if (commercial && !t.voice.license.commercial) {
      blocked.push({ path: `tracks[${t.index}].voice`, message: `Voice "${t.voice.id}" does not allow commercial use: ${t.voice.license.summary}` });
    }
  }
  if (blocked.length) {
    throw new CliError({
      code: "LICENSE_NONCOMMERCIAL",
      message: "--commercial was requested but some voices forbid commercial use",
      hint: "Switch those tracks to a voice whose license allows it (`vocaloid voice list`)",
      details: blocked,
    });
  }
  return [...credits];
}

function phonemizationError(song: CompiledSong, track: CompiledVocalTrack, err: EnginePhonemizationError): CliError {
  const details = err.failures.map((f) => {
    const note = track.notes.find((n) => n.tick === f.tick);
    return {
      path: note ? `tracks[${track.index}].notes[${note.index}].lyric` : `tracks[${track.index}]`,
      message: `"${f.lyric}" at ${song.grid.label(f.tick)}: ${f.error}`,
    };
  });
  return new CliError({
    code: "PHONEMIZATION_FAILED",
    message: `Voice "${track.voice.id}" could not pronounce ${details.length} lyric(s) on track "${track.id}" (${track.language})`,
    hint:
      track.language === "ja"
        ? "Use one kana mora per note (e.g. か, きゃ, ん) or romaji (ka, kya, n); fix the lyrics or set `phonemes`."
        : "Put the whole word on its first note and \"+\" on continuation notes; check spelling or set `phonemes`.",
    details,
    exitCode: ExitCode.phonemization,
  });
}

export function creditsMarkdown(song: CompiledSong, credits: string[], instruments: boolean): string {
  return [
    `# Credits — ${song.title}`,
    "",
    "## Voices",
    ...credits.map((c) => `- ${c}`),
    "",
    "## Tools",
    "- Rendered with @jibaru/vocaloid-cli, OpenUtau (MIT) and DiffSinger.",
    ...(instruments ? [`- Instruments: ${DEFAULT_SOUNDFONT.credit}, rendered with FluidSynth.`] : []),
    "",
  ].join("\n");
}

export async function renderSong(dir: string, opts: RenderOptions) {
  const loaded = await loadSong(dir);
  const song = loaded.compiled;
  const only = opts.only?.split(",").map((s) => s.trim());
  for (const id of only ?? []) {
    if (!song.tracks.some((t) => t.id === id)) {
      throw new CliError({ code: "TRACK_NOT_FOUND", message: `No track "${id}"`, hint: `vocaloid song inspect ${dir}` });
    }
  }
  const loudness = Number(opts.loudness);
  if (!Number.isFinite(loudness) || loudness > -5 || loudness < -40) {
    throw new CliError({ code: "INVALID_ARGUMENT", message: "--loudness must be a LUFS value between -40 and -5" });
  }
  const credits = checkLicenses(song, Boolean(opts.commercial));
  const selected = song.tracks.filter((t) => !t.mute && t.notes.length > 0 && (!only || only.includes(t.id)));
  if (selected.length === 0) {
    throw new CliError({ code: "NOTHING_TO_RENDER", message: "No unmuted tracks with notes to render", hint: `vocaloid song inspect ${dir}` });
  }
  const hasVocals = selected.some((t) => t.kind === "vocal");
  if (hasVocals) {
    await requireEngine();
    await ensureVoicesInstalled(song);
  }
  await requireFfmpeg();

  const build = join(loaded.dir, BUILD_DIR);
  const cacheDir = join(build, ".cache");
  const stemsDir = join(build, "stems");
  await mkdir(cacheDir, { recursive: true });
  await mkdir(stemsDir, { recursive: true });

  // Project files next to the audio, so a human can open them in OpenUtau or a DAW.
  const ustxPath = join(build, "song.ustx");
  const midiPath = join(build, "song.mid");
  await writeAtomic(ustxPath, toUstx(song));
  await writeAtomic(midiPath, toMidi(song));

  const version = await engineVersion();
  const stems: (Stem & { track: string; cached: boolean })[] = [];
  const warnings = [...loaded.warnings];
  let done = 0;
  for (const track of selected) {
    progress({ task: "Rendering stems", done, total: selected.length, unit: "tracks", message: track.id });
    const stemPath = join(stemsDir, `${track.id}.wav`);
    let cached: boolean;
    if (track.kind === "vocal") {
      const ustx = toUstx(song, { trackIds: [track.id] });
      const key = sha256(`${ustx}\n${version}`).slice(0, 16);
      const cachePath = join(cacheDir, `vocal-${track.id}-${key}.wav`);
      cached = await exists(cachePath);
      if (!cached) {
        step(track.id, `singing with ${track.voice.id}…`);
        const ustxFile = join(cacheDir, `vocal-${track.id}-${key}.ustx`);
        await writeFile(ustxFile, ustx);
        try {
          await renderUstx(ustxFile, cachePath);
        } catch (err) {
          if (err instanceof EnginePhonemizationError) throw phonemizationError(song, track, err);
          throw err;
        }
      }
      await copyFile(cachePath, stemPath);
    } else {
      const result = await renderInstrumentStem(song, track, cacheDir, stemPath);
      cached = result.cached;
      warnings.push(...result.warnings);
    }
    stems.push({ track: track.id, path: stemPath, volumeDb: track.volume, pan: track.pan, fx: track.fx, cached });
    done++;
  }
  progress({ task: "Rendering stems", done, total: selected.length, unit: "tracks" });

  step("mix", `mixing ${stems.length} stem(s) to ${loudness} LUFS…`);
  const mixWav = join(build, "mix.wav");
  const mixMp3 = opts.mp3 ? join(build, "mix.mp3") : null;
  await mixStems(stems, mixWav, mixMp3, { loudness, sampleRate: 44100 });

  const creditsPath = join(loaded.dir, "CREDITS.md");
  await writeAtomic(creditsPath, creditsMarkdown(song, credits, selected.some((t) => t.kind === "instrument")));

  return {
    song: song.title,
    dir: loaded.dir,
    mix: {
      wav: mixWav,
      mp3: mixMp3,
      durationSeconds: Number(((await probeDuration(mixWav)) ?? tickToSeconds(song.endTick, song.tempos)).toFixed(2)),
      loudnessLufs: loudness,
    },
    stems: stems.map((s) => ({ track: s.track, path: s.path, cached: s.cached })),
    projectFiles: { ustx: ustxPath, midi: midiPath },
    credits: { file: creditsPath, voices: credits },
    warnings,
  };
}

export function registerRender(program: Command): void {
  program
    .command("render")
    .description("Render song.yaml to audio: per-track stems + mix.wav/mix.mp3 (cached per track)")
    .argument("[dir]", "song directory or song.yaml", ".")
    .option("--only <ids>", "render only these comma-separated track ids")
    .option("--no-mp3", "skip the mp3 encode")
    .option("--loudness <lufs>", "integrated loudness target for the mix", "-14")
    .option("--commercial", "fail if any voice's license forbids commercial use")
    .action(async (dir: string, opts: RenderOptions) => {
      const started = Date.now();
      const result = await renderSong(dir, opts);
      const rel = (p: string) => relative(process.cwd(), p);
      emit({
        data: { ...result, elapsedSeconds: Number(((Date.now() - started) / 1000).toFixed(1)) },
        warnings: result.warnings,
        human: (d) =>
          [
            success(`Rendered ${bold(d.song)} ${muted(`in ${d.elapsedSeconds}s`)}`),
            `  ${muted("mix    ")} ${bold(rel(d.mix.mp3 ?? d.mix.wav))} ${muted(`${d.mix.durationSeconds.toFixed(1)}s @ ${d.mix.loudnessLufs} LUFS`)}`,
            ...d.stems.map((s) => `  ${muted("stem   ")} ${rel(s.path)}${s.cached ? muted(" (cached)") : ""}`),
            `  ${muted("project")} ${rel(d.projectFiles.ustx)}  ${rel(d.projectFiles.midi)}`,
            `  ${muted("credits")} ${rel(d.credits.file)}`,
          ].join("\n"),
        nextSteps: [
          process.platform === "darwin" ? `afplay ${rel(result.mix.mp3 ?? result.mix.wav)}` : `ffplay -autoexit ${rel(result.mix.mp3 ?? result.mix.wav)}`,
          `vocaloid song inspect ${dir}`,
        ],
      });
    });
}
