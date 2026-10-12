import { describe, expect, test } from "bun:test";
import { countSyllables, splitEnglish, splitJapanese } from "../src/model/lyrics.ts";

const texts = (r: { units: { text: string }[] }) => r.units.map((u) => u.text);

describe("japanese", () => {
  test("one mora per note; small kana join; ー continues", () => {
    expect(texts(splitJapanese("きみのこえ"))).toEqual(["き", "み", "の", "こ", "え"]);
    expect(texts(splitJapanese("しゃしん ちょっと"))).toEqual(["しゃ", "し", "ん", "ちょ", "っ", "と"]);
    expect(texts(splitJapanese("ラーメン"))).toEqual(["ラ", "+", "メ", "ン"]);
  });
  test("romaji", () => {
    expect(texts(splitJapanese("kimi no koe"))).toEqual(["ki", "mi", "no", "ko", "e"]);
    expect(texts(splitJapanese("kyou shinjitte"))).toEqual(["kyo", "u", "shi", "n", "ji", "っ", "te"]);
    expect(texts(splitJapanese("konnichiwa"))).toEqual(["ko", "n", "ni", "chi", "wa"]);
  });
  test("kanji is reported as unparsed, never guessed", () => {
    const r = splitJapanese("君の声");
    expect(r.unparsed).toEqual(["君の声"]);
  });
});

describe("english", () => {
  test("word on first note, + for extra syllables", () => {
    expect(texts(splitEnglish("I can hear your voice"))).toEqual(["I", "can", "hear", "your", "voice"]);
    expect(texts(splitEnglish("beautiful tonight"))).toEqual(["beautiful", "+", "+", "tonight", "+"]);
  });
  test("hyphens force the syllable split", () => {
    expect(texts(splitEnglish("fi-re"))).toEqual(["fire", "+"]);
  });
  test("syllable heuristic", () => {
    expect(countSyllables("love")).toBe(1);
    expect(countSyllables("dancing")).toBe(2);
    expect(countSyllables("together")).toBe(3);
  });
});
