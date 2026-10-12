import { CliError, ExitCode } from "../lib/errors.ts";
import { run, which } from "../lib/proc.ts";

export async function requireFfmpeg(): Promise<string> {
  const path = await which("ffmpeg");
  if (!path) {
    throw new CliError({
      code: "FFMPEG_MISSING",
      message: "ffmpeg is required for mixing and encoding",
      hint: "Install it (macOS: `brew install ffmpeg`; Debian/Ubuntu: `apt install ffmpeg`), then run `vocaloid doctor`",
      exitCode: ExitCode.missingDependency,
    });
  }
  return path;
}

export interface Stem {
  path: string;
  volumeDb: number;
  pan: number; // -100..100
  fx?: "none" | "vocal" | "room";
}

/** ffmpeg filter chains per effect preset. Kept small and deterministic. */
export const FX_CHAINS: Record<"vocal" | "room", string> = {
  vocal:
    "highpass=f=100,acompressor=threshold=-18dB:ratio=3:attack=5:release=80:makeup=2," +
    "aecho=0.85:0.5:45|90|140:0.22|0.14|0.08",
  room: "aecho=0.9:0.6:60|120:0.18|0.1",
};

export interface MixOptions {
  /** Integrated loudness target in LUFS. Streaming platforms normalize around -14. */
  loudness: number;
  sampleRate: number;
}

/** Balance gains for a stereo signal, -100 = hard left. */
export function panGains(pan: number): [number, number] {
  const p = Math.max(-100, Math.min(100, pan)) / 100;
  return [Math.min(1, 1 - p), Math.min(1, 1 + p)];
}

export function mixFilter(stems: Stem[], opts: MixOptions): string {
  const chains = stems.map((s, i) => {
    const [l, r] = panGains(s.pan);
    return (
      `[${i}:a]aresample=${opts.sampleRate},aformat=channel_layouts=stereo,` +
      (s.fx && s.fx !== "none" ? `${FX_CHAINS[s.fx]},` : "") +
      `volume=${s.volumeDb}dB,pan=stereo|c0=${l.toFixed(3)}*c0|c1=${r.toFixed(3)}*c1[s${i}]`
    );
  });
  const inputs = stems.map((_, i) => `[s${i}]`).join("");
  return (
    `${chains.join(";")};${inputs}amix=inputs=${stems.length}:normalize=0:duration=longest,` +
    `loudnorm=I=${opts.loudness}:TP=-1:LRA=11,aresample=${opts.sampleRate}[out]`
  );
}

export async function mixStems(stems: Stem[], outWav: string, outMp3: string | null, opts: MixOptions): Promise<void> {
  const ffmpeg = await requireFfmpeg();
  if (stems.length === 0) throw new CliError({ code: "NOTHING_TO_MIX", message: "No audible tracks to mix" });
  const args = ["-hide_banner", "-loglevel", "error", "-y"];
  for (const s of stems) args.push("-i", s.path);
  args.push("-filter_complex", mixFilter(stems, opts), "-map", "[out]", "-c:a", "pcm_s16le", outWav);
  const r = await run(ffmpeg, args);
  if (r.code !== 0) {
    throw new CliError({ code: "MIX_FAILED", message: r.stderr.trim().slice(0, 1000), exitCode: ExitCode.renderFailure });
  }
  if (outMp3) {
    const e = await run(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-i", outWav, "-c:a", "libmp3lame", "-q:a", "2", outMp3]);
    if (e.code !== 0) {
      throw new CliError({ code: "ENCODE_FAILED", message: e.stderr.trim().slice(0, 1000), exitCode: ExitCode.renderFailure });
    }
  }
}

export async function probeDuration(path: string): Promise<number | null> {
  const ffprobe = await which("ffprobe");
  if (!ffprobe) return null;
  const r = await run(ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path]);
  const value = Number.parseFloat(r.stdout.trim());
  return Number.isFinite(value) ? value : null;
}
