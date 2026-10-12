import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CliError, ExitCode } from "../lib/errors.ts";
import { exists } from "../lib/fsx.ts";
import { engineDir, openUtauDataDir } from "../lib/paths.ts";
import { run } from "../lib/proc.ts";

/**
 * Wrapper around the headless OpenUtau CLI (see engine/README.md).
 * Exit codes of the engine: 0 ok, 2 args, 3 invalid project, 4 missing singer, 5 render, 6 phonemization.
 */

export const ENGINE_BINARY = "OpenUtau.Cli";

export async function enginePath(): Promise<string | null> {
  const override = process.env.VOCALOID_CLI_ENGINE;
  if (override) return (await exists(override)) ? override : null;
  const path = join(engineDir(), ENGINE_BINARY);
  return (await exists(path)) ? path : null;
}

export async function engineVersion(): Promise<string> {
  try {
    return (await readFile(join(engineDir(), "VERSION"), "utf8")).trim();
  } catch {
    return process.env.VOCALOID_CLI_ENGINE ? "custom" : "unknown";
  }
}

export async function requireEngine(): Promise<string> {
  const path = await enginePath();
  if (!path) {
    throw new CliError({
      code: "ENGINE_MISSING",
      message: "The OpenUtau render engine is not installed",
      hint: "Run `vocaloid setup` (or set VOCALOID_CLI_ENGINE to an OpenUtau.Cli binary)",
      exitCode: ExitCode.missingDependency,
    });
  }
  return path;
}

export interface PhonemeFailure {
  tick: number;
  lyric: string;
  error: string;
}

export class EnginePhonemizationError extends Error {
  constructor(readonly failures: PhonemeFailure[]) {
    super(`Phonemization failed for ${failures.length} note(s)`);
  }
}

function parseJsonLine(text: string): Record<string, unknown> | null {
  const lines = text.trim().split("\n").reverse();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      return JSON.parse(trimmed) as Record<string, unknown>;
    } catch {}
  }
  return null;
}

export async function renderUstx(ustxPath: string, outWav: string): Promise<void> {
  const bin = await requireEngine();
  const result = await run(bin, [
    "render",
    "--project",
    ustxPath,
    "--output",
    outWav,
    "--data-path",
    openUtauDataDir(),
  ]);
  if (result.code === 0) return;
  const payload = parseJsonLine(result.stderr) ?? {};
  const message = String(payload.error ?? result.stderr.trim().slice(0, 2000));
  switch (result.code) {
    case 6:
      throw new EnginePhonemizationError((payload.failures as PhonemeFailure[]) ?? []);
    case 4:
      throw new CliError({
        code: "VOICE_NOT_INSTALLED",
        message,
        hint: "Run `vocaloid voice list` and `vocaloid voice install <id>`",
        exitCode: ExitCode.missingDependency,
      });
    case 3:
      throw new CliError({
        code: "ENGINE_INVALID_PROJECT",
        message: `The engine rejected the generated project: ${message.split("\n")[0]}`,
        hint: "This is likely a vocaloid-cli bug; re-run with VOCALOID_DEBUG=1 and report it",
        exitCode: ExitCode.renderFailure,
      });
    default:
      throw new CliError({
        code: "RENDER_FAILED",
        message: `Engine exited with code ${result.code}: ${message.split("\n")[0]}`,
        hint: "Run `vocaloid doctor` to check the engine and voices",
        exitCode: ExitCode.renderFailure,
      });
  }
}

export async function listEngineSingers(): Promise<{ Id: string; Name: string; type: string }[]> {
  const bin = await requireEngine();
  const result = await run(bin, ["list-singers", "--data-path", openUtauDataDir()]);
  if (result.code !== 0) {
    throw new CliError({
      code: "ENGINE_FAILED",
      message: `list-singers failed: ${result.stderr.trim().slice(0, 500)}`,
      exitCode: ExitCode.missingDependency,
    });
  }
  const parsed = parseJsonLine(result.stdout);
  return (parsed?.singers as { Id: string; Name: string; type: string }[]) ?? [];
}
