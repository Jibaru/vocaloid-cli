import { copyFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { requireFluidsynth, requireSoundfont } from "../engines/fluidsynth.ts";
import { toMidi } from "../formats/midi.ts";
import { CliError, ExitCode } from "../lib/errors.ts";
import { exists, sha256 } from "../lib/fsx.ts";
import { run } from "../lib/proc.ts";
import type { CompiledInstrumentTrack, CompiledSong } from "../model/compile.ts";

/** Render one instrument track to a WAV stem through FluidSynth, cached by content hash. */
export async function renderInstrumentStem(
  song: CompiledSong,
  track: CompiledInstrumentTrack,
  cacheDir: string,
  stemPath: string,
): Promise<{ cached: boolean; warnings: string[] }> {
  const fluidsynth = await requireFluidsynth();
  const soundfont = await requireSoundfont();
  const midi = toMidi(song, { trackIds: [track.id] });
  const key = sha256(Buffer.concat([Buffer.from(midi), Buffer.from(`${soundfont.id}`)])).slice(0, 16);
  const cachePath = join(cacheDir, `inst-${track.id}-${key}.wav`);
  const cached = await exists(cachePath);
  if (!cached) {
    const midiPath = join(cacheDir, `inst-${track.id}-${key}.mid`);
    await writeFile(midiPath, midi);
    const r = await run(fluidsynth, [
      "-ni", // no MIDI input, no shell
      "-q",
      "-g",
      "0.6",
      "-r",
      "44100",
      "-F",
      cachePath,
      soundfont.path,
      midiPath,
    ]);
    if (r.code !== 0 || !(await exists(cachePath))) {
      throw new CliError({
        code: "INSTRUMENT_RENDER_FAILED",
        message: `FluidSynth failed on track "${track.id}": ${r.stderr.trim().slice(0, 500)}`,
        hint: "Run `vocaloid doctor`",
        exitCode: ExitCode.renderFailure,
      });
    }
  }
  await copyFile(cachePath, stemPath);
  return { cached, warnings: [] };
}
