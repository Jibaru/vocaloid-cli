import { describe, expect, test } from "bun:test";
import { parse } from "yaml";
import { VOICES } from "../src/catalog/voices.ts";
import { styledSong } from "../src/commands/init.ts";
import { inferSectionKind } from "../src/model/compile.ts";
import { compileSong } from "../src/model/compile.ts";
import { parseChord, parseKey, romanToChord } from "../src/model/chords.ts";
import { Song } from "../src/model/song.ts";
import { STYLES, findStyle } from "../src/styles/presets.ts";

const voices = VOICES.map((v) => ({ ...v, source: "catalog" as const }));

describe("chords", () => {
  test("roman numerals in a major key", () => {
    expect(["IV", "III7", "vi", "I"].map((r) => romanToChord(r, "A"))).toEqual(["D", "C#7", "F#m", "A"]);
    expect(romanToChord("bVII", "A")).toBe("G");
    expect(romanToChord("iim7", "C")).toBe("Dm7");
  });
  test("minor keys use their relative major", () => {
    expect(parseKey("F# minor").majorTonic).toBe("A");
    expect(parseKey("E major").majorTonic).toBe("E");
  });
  test("slash chords keep their bass", () => {
    const c = parseChord("E/G#");
    expect(c.root).toBe(4);
    expect(c.bass).toBe(8);
  });
  test("section kinds are inferred from names", () => {
    expect(["intro", "A", "B", "chorus", "サビ", "bridge", "outro"].map(inferSectionKind)).toEqual([
      "intro", "verse", "pre", "chorus", "chorus", "bridge", "outro",
    ]);
  });
});

describe("styles", () => {
  for (const style of STYLES) {
    test(`${style.id}: scaffold + every generated part compiles deterministically`, () => {
      const yaml = parse(styledSong(style, { title: "t", voice: "hanami", language: "ja" }));
      yaml.tracks.push(
        ...style.parts.map((p) => ({ id: p.id, kind: "instrument", instrument: p.instrument, generate: { part: p.id } })),
      );
      const a = compileSong(Song.parse(yaml), voices);
      expect(a.errors).toEqual([]);
      const b = compileSong(Song.parse(yaml), voices);
      for (const t of a.song!.tracks) {
        if (t.kind !== "instrument") continue;
        expect(t.generated!.notes).toBeGreaterThan(0);
        expect(t.notes.every((n) => n.tick < a.song!.endTick)).toBe(true);
        expect(t.notes.map((n) => [n.tick, n.midi])).toEqual(b.song!.tracks.find((x) => x.id === t.id)!.notes.map((n) => [n.tick, n.midi]));
      }
    });
  }

  test("bass follows the chord root", () => {
    const style = findStyle("jrock-vocaloid")!;
    const yaml = parse(styledSong(style, { title: "t", voice: "hanami", language: "ja", key: "A major" }));
    yaml.tracks.push({ id: "bass", kind: "instrument", instrument: "electric_bass_pick", generate: { part: "bass" } });
    const song = compileSong(Song.parse(yaml), voices).song!;
    const bass = song.tracks.find((t) => t.id === "bass")!;
    // Bar 1 of the intro is vi = F#m: first bass note is an F#.
    expect(bass.notes[0]!.midi % 12).toBe(6);
  });
});
