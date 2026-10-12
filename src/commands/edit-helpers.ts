import { type Document, isMap, isSeq, type YAMLMap, type YAMLSeq } from "yaml";
import { CliError } from "../lib/errors.ts";
import type { LoadedSong } from "../model/io.ts";
import { type BarGrid, positionTicks } from "../model/music.ts";

/** JSON input for --params/--set. Accepts an object or an array of objects. */
export function parseJsonInput(flag: string, text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new CliError({
      code: "INVALID_JSON",
      message: `${flag} is not valid JSON: ${e instanceof Error ? e.message : e}`,
      hint: `Example: ${flag} '{"at":"5:1","pitch":"C5","dur":"1/8","lyric":"ら"}'`,
    });
  }
}

export function trackIndex(loaded: LoadedSong, id: string | undefined): number {
  if (!id) {
    if (loaded.data.tracks.length === 1) return 0;
    throw new CliError({
      code: "TRACK_REQUIRED",
      message: "--track is required when the song has more than one track",
      hint: `Tracks: ${loaded.data.tracks.map((t) => t.id).join(", ")}`,
    });
  }
  const index = loaded.data.tracks.findIndex((t) => t.id === id);
  if (index < 0) {
    throw new CliError({
      code: "TRACK_NOT_FOUND",
      message: `No track "${id}"`,
      hint: `Tracks: ${loaded.data.tracks.map((t) => t.id).join(", ") || "(none) — add one with \`vocaloid track add\`"}`,
    });
  }
  return index;
}

export function tracksSeq(doc: Document): YAMLSeq {
  let seq = doc.get("tracks", true);
  if (!isSeq(seq)) {
    doc.set("tracks", doc.createNode([]));
    seq = doc.get("tracks", true);
  }
  return seq as YAMLSeq;
}

export function notesSeq(doc: Document, ti: number): YAMLSeq {
  const track = tracksSeq(doc).items[ti];
  if (!isMap(track)) throw new CliError({ code: "INVALID_SONG", message: `tracks[${ti}] is not a mapping` });
  let seq = track.get("notes", true);
  if (!isSeq(seq)) {
    track.set("notes", doc.createNode([]));
    seq = track.get("notes", true);
  }
  return seq as unknown as YAMLSeq;
}

/** Keep notes ordered by position so the file stays readable and indices are predictable. */
export function sortNotes(seq: YAMLSeq, grid: BarGrid): void {
  const tick = (node: unknown) => {
    const at = (isMap(node) ? (node as YAMLMap).toJSON() : {})?.at;
    try {
      return positionTicks(at, grid);
    } catch {
      return Number.MAX_SAFE_INTEGER;
    }
  };
  seq.items.sort((a, b) => tick(a) - tick(b));
}

export function parseIndices(text: string, max: number): number[] {
  const out = new Set<number>();
  for (const part of text.split(",")) {
    const range = /^(\d+)-(\d+)$/.exec(part.trim());
    if (range) {
      for (let i = Number(range[1]); i <= Number(range[2]); i++) out.add(i);
    } else if (/^\d+$/.test(part.trim())) {
      out.add(Number(part.trim()));
    } else {
      throw new CliError({ code: "INVALID_ARGUMENT", message: `Invalid index "${part}" (use 3, 3,5 or 3-7)` });
    }
  }
  const bad = [...out].filter((i) => i >= max);
  if (bad.length) throw new CliError({ code: "INDEX_OUT_OF_RANGE", message: `Index ${bad.join(", ")} out of range (track has ${max} notes)` });
  return [...out].sort((a, b) => a - b);
}
