import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { type Document, parseDocument } from "yaml";
import { allVoices } from "../catalog/registry.ts";
import { CliError, type ErrorDetail, ExitCode } from "../lib/errors.ts";
import { backup, writeAtomic } from "../lib/fsx.ts";
import { HISTORY_DIR, SONG_FILE } from "../lib/paths.ts";
import { type CompiledSong, compileSong } from "./compile.ts";
import { Song, type SongData } from "./song.ts";

export interface LoadedSong {
  dir: string;
  file: string;
  doc: Document;
  data: SongData;
  compiled: CompiledSong;
  warnings: string[];
}

/** Accepts a song directory or a path to song.yaml / song.json. */
export async function resolveSongPath(target = "."): Promise<{ dir: string; file: string }> {
  const abs = resolve(target);
  let info;
  try {
    info = await stat(abs);
  } catch {
    throw new CliError({
      code: "SONG_NOT_FOUND",
      message: `No song at ${abs}`,
      hint: "Create one with `vocaloid init <dir>`",
    });
  }
  if (info.isDirectory()) {
    const file = join(abs, SONG_FILE);
    try {
      await stat(file);
    } catch {
      throw new CliError({
        code: "SONG_NOT_FOUND",
        message: `${abs} has no ${SONG_FILE}`,
        hint: `Create one with \`vocaloid init ${target}\``,
      });
    }
    return { dir: abs, file };
  }
  return { dir: resolve(abs, ".."), file: abs };
}

export function zodIssues(error: { issues: { path: PropertyKey[]; message: string }[] }): ErrorDetail[] {
  return error.issues.map((issue) => ({
    path: issue.path
      .map((p, i) => (typeof p === "number" ? `[${p}]` : `${i === 0 ? "" : "."}${String(p)}`))
      .join(""),
    message: issue.message,
  }));
}

export function parseSongText(text: string, file: string): { doc: Document; data: SongData } {
  const doc = parseDocument(text, { prettyErrors: true });
  if (doc.errors.length > 0) {
    throw new CliError({
      code: "SONG_PARSE_ERROR",
      message: `${file} is not valid YAML`,
      details: doc.errors.map((e) => ({ message: e.message })),
      exitCode: ExitCode.invalidSong,
    });
  }
  const parsed = Song.safeParse(doc.toJS());
  if (!parsed.success) {
    throw new CliError({
      code: "SONG_INVALID",
      message: `${file} does not match the song schema (${parsed.error.issues.length} problem(s))`,
      hint: "Run `vocaloid schema song` for the full schema",
      details: zodIssues(parsed.error),
      exitCode: ExitCode.invalidSong,
    });
  }
  return { doc, data: parsed.data };
}

export async function loadSong(target = "."): Promise<LoadedSong> {
  const { dir, file } = await resolveSongPath(target);
  const text = await readFile(file, "utf8");
  const { doc, data } = parseSongText(text, file);
  const { song, errors, warnings } = compileSong(data, await allVoices());
  if (!song) {
    throw new CliError({
      code: "SONG_INVALID",
      message: `${file} has ${errors.length} problem(s)`,
      details: errors,
      exitCode: ExitCode.invalidSong,
    });
  }
  return { dir, file, doc, data, compiled: song, warnings };
}

/** Validate the edited document fully, back up the old file, then write atomically. */
export async function saveSongDoc(
  file: string,
  dir: string,
  doc: Document,
  opts: { dryRun?: boolean } = {},
): Promise<LoadedSong> {
  const text = doc.toString({ lineWidth: 0 });
  const { data } = parseSongText(text, file);
  const { song, errors, warnings } = compileSong(data, await allVoices());
  if (!song) {
    throw new CliError({
      code: "EDIT_INVALID",
      message: `The edit would leave the song invalid (${errors.length} problem(s)); nothing was written`,
      details: errors,
      exitCode: ExitCode.invalidSong,
    });
  }
  if (!opts.dryRun) {
    await backup(file, join(dir, HISTORY_DIR));
    await writeAtomic(file, text);
  }
  return { dir, file, doc, data, compiled: song, warnings };
}
