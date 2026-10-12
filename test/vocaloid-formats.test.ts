import { describe, expect, test } from "bun:test";
import { strFromU8, unzipSync } from "fflate";
import { BUILTIN_SINGERS } from "../src/catalog/singers.ts";
import { VOICES } from "../src/catalog/voices.ts";
import { importProject } from "../src/formats/import.ts";
import { kanaToRomaji } from "../src/formats/kana.ts";
import { vocaloidText } from "../src/formats/vocaloid-common.ts";
import { toVpr } from "../src/formats/vpr.ts";
import { toVsqx } from "../src/formats/vsqx.ts";
import { compileSong } from "../src/model/compile.ts";
import { Song } from "../src/model/song.ts";

const voices = VOICES.map((v) => ({ ...v, source: "catalog" as const }));
const singer = BUILTIN_SINGERS[0]!;
const song = compileSong(
  Song.parse({
    schemaVersion: 1,
    title: "T",
    tempo: [{ at: 0, bpm: 150 }, { at: "3:1", bpm: 160 }],
    tracks: [
      {
        id: "lead",
        kind: "vocal",
        voice: "hanami",
        language: "ja",
        notes: [
          { at: "1:1", pitch: "A4", dur: 0.5, lyric: "しゃ" },
          { at: "1:1.5", pitch: "B4", dur: 0.5, lyric: "+" },
          { at: "1:3", pitch: "C#5", dur: 1, lyric: "ふ" },
          { at: "2:1", pitch: "E5", dur: 2, lyric: "ん" },
        ],
        curves: { dynamics: [{ at: 0, value: 0 }, { at: "2:1", value: 50 }] },
      },
    ],
  }),
  voices,
).song!;

describe("vocaloid phonemes", () => {
  test("kana → romaji → VOCALOID X-SAMPA", () => {
    expect(kanaToRomaji("しゃ")).toBe("sha");
    expect(kanaToRomaji("ティ")).toBe("ti");
    expect(vocaloidText("ja", "ふ").phoneme).toBe("p\\ M");
    expect(vocaloidText("ja", "き").phoneme).toBe("k' i");
    expect(vocaloidText("ja", "+")).toEqual({ lyric: "-", phoneme: "-", derived: true });
  });
  test("non-Japanese gets a placeholder flagged for re-conversion", () => {
    expect(vocaloidText("en", "hello").derived).toBe(false);
  });
});

describe(".vpr", () => {
  const { bytes } = toVpr(song, { singerFor: () => singer });
  const json = JSON.parse(strFromU8(unzipSync(bytes)["Project/sequence.json"]!));
  test("zip holds Project/sequence.json with tempo ×100 and 0-based bars", () => {
    expect(json.masterTrack.tempo.events).toEqual([{ pos: 0, value: 15000 }, { pos: 3840, value: 16000 }]);
    expect(json.masterTrack.timeSig.events[0]).toEqual({ bar: 0, numer: 4, denom: 4 });
    expect(json.voices[0].compID).toBe(singer.compID);
  });
  test("notes carry lyric, phoneme, legato and controller values", () => {
    const part = json.tracks[0].parts[0];
    expect(part.voice).toEqual({ compID: singer.compID, langID: 0 });
    expect(part.notes.map((n: { lyric: string }) => n.lyric)).toEqual(["しゃ", "-", "ふ", "ん"]);
    expect(part.notes[0].phoneme).toBe("S a");
    expect(part.controllers[0]).toEqual({ name: "dynamics", events: [{ pos: 0, value: 64 }, { pos: 1920, value: 96 }] });
  });
  test("round-trips through import", () => {
    const { song: back } = importProject("vpr", bytes, { title: "x", voice: "hanami" });
    const notes = (back.tracks![0] as { notes: { at: string; lyric: string }[] }).notes;
    expect(notes.map((n) => [n.at, n.lyric])).toEqual([["1:1", "しゃ"], ["1:1.5", "+"], ["1:3", "ふ"], ["2:1", "ん"]]);
  });
});

describe(".vsqx", () => {
  const { text } = toVsqx(song, { singerFor: () => singer });
  test("vsq4 with one pre-measure: part and later tempos shift by one bar", () => {
    expect(text).toContain('xmlns="http://www.yamaha.co.jp/vocaloid/schema/vsq4/"');
    expect(text).toContain("<preMeasure>1</preMeasure>");
    expect(text).toContain("<vsPart>\n<t>1920</t>");
    expect(text).toContain("<tempo><t>5760</t><v>16000</v></tempo>");
  });
  test("round-trips through import", () => {
    const { song: back } = importProject("vsqx", new TextEncoder().encode(text), { title: "x", voice: "hanami" });
    const notes = (back.tracks![0] as { notes: { at: string; pitch: string }[] }).notes;
    expect(notes.map((n) => [n.at, n.pitch])).toEqual([["1:1", "A4"], ["1:1.5", "B4"], ["1:3", "C#5"], ["2:1", "E5"]]);
  });
});
