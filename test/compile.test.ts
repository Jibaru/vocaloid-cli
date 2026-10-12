import { describe, expect, test } from "bun:test";
import { parse } from "yaml";
import { VOICES } from "../src/catalog/voices.ts";
import { starterSong } from "../src/commands/init.ts";
import { toMidi } from "../src/formats/midi.ts";
import { toUstx } from "../src/formats/ustx.ts";
import { compileSong } from "../src/model/compile.ts";
import { Song } from "../src/model/song.ts";

const voices = VOICES.map((v) => ({ ...v, source: "catalog" as const }));

function compile(input: unknown) {
  return compileSong(Song.parse(input), voices);
}

const base = {
  schemaVersion: 1,
  title: "T",
  tempo: 120,
  tracks: [
    {
      id: "lead",
      kind: "vocal",
      voice: "hanami",
      language: "ja",
      notes: [
        { at: "1:1", pitch: "C5", dur: "1/4", lyric: "ら" },
        { at: "1:2", pitch: "D5", dur: "1/4", lyric: "ら" },
      ],
    },
  ],
};

describe("compileSong", () => {
  test("starter song is valid", () => {
    for (const lang of ["ja", "en"] as const) {
      const r = compile(parse(starterSong("x", "hanami", lang)));
      expect(r.errors).toEqual([]);
    }
  });

  test("overlapping vocal notes are reported with paths", () => {
    const input = structuredClone(base);
    input.tracks[0]!.notes[1]!.at = "1:1.5";
    const r = compile(input);
    expect(r.song).toBeUndefined();
    expect(r.errors[0]!.path).toBe("tracks[0].notes[1]");
  });

  test("collects every problem in one pass", () => {
    const input = structuredClone(base) as typeof base & { tracks: Record<string, unknown>[] };
    (input.tracks[0] as Record<string, unknown>).voice = "nope";
    input.tracks[0]!.notes[0]!.pitch = "H9";
    const r = compile(input);
    const paths = r.errors.map((e) => e.path);
    expect(paths).toContain("tracks[0].voice");
    expect(paths).toContain("tracks[0].notes[0].pitch");
  });

  test("every Hanami language compiles (de shown)", () => {
    const input = structuredClone(base);
    (input.tracks[0] as Record<string, unknown>).language = "de";
    expect(compile(input).errors).toEqual([]);
  });

  test("drum names resolve on drum tracks only", () => {
    const r = compile({
      ...base,
      tracks: [{ id: "d", kind: "instrument", instrument: "drums", notes: [{ at: 0, pitch: "kick", dur: 0.5 }] }],
    });
    expect(r.errors).toEqual([]);
    expect(r.song!.tracks[0]!.notes[0]!.midi).toBe(36);
  });
});

describe("emitters", () => {
  const song = compile(base).song!;

  test("ustx carries singer, phonemizer, ticks and tones", () => {
    const ustx = parse(toUstx(song));
    expect(ustx.ustx_version).toBe("0.9");
    expect(ustx.tracks[0].singer).toBe("Hoshino Hanami ~AIdol~ for DiffSinger v1.0");
    expect(ustx.tracks[0].phonemizer).toBe("OpenUtau.Core.DiffSinger.DiffSingerJapanesePhonemizer");
    expect(ustx.voice_parts[0].notes.map((n: { position: number; tone: number }) => [n.position, n.tone])).toEqual([
      [0, 72],
      [480, 74],
    ]);
  });

  test("phoneme override uses OpenUtau bracket hint", () => {
    const input = structuredClone(base) as typeof base;
    (input.tracks[0]!.notes[0] as Record<string, unknown>).phonemes = "r a";
    const ustx = parse(toUstx(compile(input).song!));
    expect(ustx.voice_parts[0].notes[0].lyric).toBe("ら[r a]");
  });

  test("midi is a valid SMF", () => {
    const bytes = toMidi(song);
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("MThd");
  });
});
