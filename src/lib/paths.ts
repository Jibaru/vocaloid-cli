import { homedir } from "node:os";
import { join } from "node:path";

/** Root for engine, voices and caches. Override with VOCALOID_CLI_HOME (tests use this). */
export function cliHome(): string {
  return process.env.VOCALOID_CLI_HOME ?? join(homedir(), ".vocaloid-cli");
}

export function engineDir(): string {
  return join(cliHome(), "engine", "openutau");
}

/** The OpenUtau data path: Singers/, Cache/, prefs. */
export function openUtauDataDir(): string {
  return join(cliHome(), "openutau-data");
}

export function singersDir(): string {
  return join(openUtauDataDir(), "Singers");
}

export function downloadsDir(): string {
  return join(cliHome(), "downloads");
}

export const SONG_FILE = "song.yaml";
export const BUILD_DIR = "build";
export const HISTORY_DIR = ".history";
