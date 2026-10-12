import { join } from "node:path";
import { CliError, ExitCode } from "../lib/errors.ts";
import { exists } from "../lib/fsx.ts";
import { cliHome } from "../lib/paths.ts";
import { which } from "../lib/proc.ts";

export interface SoundfontEntry {
  id: string;
  name: string;
  file: string;
  url: string;
  sha256: string;
  bytes: number;
  credit: string;
  license: string;
}

/** Pinned to a commit so the checksum stays valid. License allows commercial music production. */
export const DEFAULT_SOUNDFONT: SoundfontEntry = {
  id: "generaluser-gs-2.0.3",
  name: "GeneralUser GS v2.0.3",
  file: "GeneralUser-GS.sf2",
  url: "https://raw.githubusercontent.com/mrbumpy409/GeneralUser-GS/684543d5e5efaef08d02be50dcda8d552478fa60/GeneralUser-GS.sf2",
  sha256: "9575028c7a1f589f5770fccc8cff2734566af40cd26ed836944e9a5152688cfe",
  bytes: 32319396,
  credit: "GeneralUser GS SoundFont by S. Christian Collins (https://schristiancollins.com)",
  license: "Free for private or commercial music creation (GeneralUser GS License v2.0)",
};

export function soundfontsDir(): string {
  return join(cliHome(), "soundfonts");
}

export async function requireFluidsynth(): Promise<string> {
  const path = await which("fluidsynth");
  if (!path) {
    throw new CliError({
      code: "FLUIDSYNTH_MISSING",
      message: "FluidSynth is required to render instrument tracks",
      hint: "Run `vocaloid setup` (macOS: `brew install fluid-synth`; Debian/Ubuntu: `apt install fluidsynth`)",
      exitCode: ExitCode.missingDependency,
    });
  }
  return path;
}

export async function requireSoundfont(): Promise<{ id: string; path: string }> {
  const path = join(soundfontsDir(), DEFAULT_SOUNDFONT.file);
  if (!(await exists(path))) {
    throw new CliError({
      code: "SOUNDFONT_MISSING",
      message: `The ${DEFAULT_SOUNDFONT.name} soundfont is not installed`,
      hint: "Run `vocaloid setup`",
      exitCode: ExitCode.missingDependency,
    });
  }
  return { id: DEFAULT_SOUNDFONT.id, path };
}
