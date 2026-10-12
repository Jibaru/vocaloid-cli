/**
 * Split a lyric line into the per-note units the engine expects.
 * Japanese: one mora per note (small ゃゅょぁぃぅぇぉゎ join the previous kana; っ and ん are morae;
 * ー becomes "+" so the vowel continues). Romaji is split into morae the same way.
 * English: one word per first note, "+" for each further syllable. "beau-ti-ful" forces the split.
 */

export interface LyricUnit {
  text: string;
  /** The source word or mora group this unit belongs to, for reporting. */
  word: string;
}

const SMALL_KANA = new Set([..."ゃゅょぁぃぅぇぉゎャュョァィゥェォヮ"]);
const KANA = /[ぁ-ゖァ-ヺー]/;

function splitKana(word: string): LyricUnit[] {
  const units: LyricUnit[] = [];
  for (const ch of word) {
    if (ch === "ー") {
      units.push({ text: "+", word });
    } else if (SMALL_KANA.has(ch) && units.length > 0 && units.at(-1)!.text !== "+") {
      units.at(-1)!.text += ch;
    } else if (KANA.test(ch)) {
      units.push({ text: ch, word });
    }
  }
  return units;
}

// Longest onsets first so "kya" wins over "k" + "ya"; "n" alone (not before a vowel/y) is ん.
const ROMAJI_MORA = /っ|(?:ky|gy|sh|ch|ts|ny|hy|by|py|my|ry|dy|ty|j|f|v|[kgsztdnhbpmyrw])?[aiueo]|n'?(?![aiueoy])|-/g;

function splitRomaji(word: string): LyricUnit[] {
  // A doubled consonant ("kitte", "matcha") is a sokuon mora: っ before the consonant.
  const lower = word.toLowerCase().replace(/([kgsztdhbpmrwfjc])\1/g, "っ$1").replace(/tch/g, "っch");
  const units: LyricUnit[] = [];
  let consumed = 0;
  for (const m of lower.matchAll(ROMAJI_MORA)) {
    if (m.index !== consumed) return []; // unparseable remainder: caller reports it
    consumed = m.index + m[0].length;
    units.push({ text: m[0] === "-" ? "+" : m[0].replace("'", ""), word });
  }
  return consumed === lower.length ? units : [];
}

export function splitJapanese(text: string): { units: LyricUnit[]; unparsed: string[] } {
  const units: LyricUnit[] = [];
  const unparsed: string[] = [];
  for (const word of text.split(/[\s、。，．,.!?！？「」『』（）()]+/).filter(Boolean)) {
    if ([...word].every((ch) => KANA.test(ch))) {
      const u = splitKana(word);
      if (u.length === 0) unparsed.push(word);
      units.push(...u);
    } else if (/^[a-z'-]+$/i.test(word)) {
      const u = splitRomaji(word);
      if (u.length === 0) unparsed.push(word);
      units.push(...u);
    } else {
      unparsed.push(word); // kanji or symbols: the agent must give the reading in kana
    }
  }
  return { units, unparsed };
}

/** Heuristic English syllable count; hyphens in the input override it. */
export function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (w.length <= 3) return 1;
  const trimmed = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
  const groups = trimmed.match(/[aeiouy]+/g);
  return Math.max(1, groups?.length ?? 1);
}

export function splitEnglish(text: string): { units: LyricUnit[]; unparsed: string[] } {
  const units: LyricUnit[] = [];
  for (const raw of text.split(/\s+/).filter(Boolean)) {
    const word = raw.replace(/^[^\p{L}']+|[^\p{L}'-]+$/gu, "");
    if (!word) continue;
    const parts = word.split("-").filter(Boolean);
    const syllables = parts.length > 1 ? parts.length : countSyllables(word);
    const joined = parts.join("");
    units.push({ text: joined, word: joined });
    for (let i = 1; i < syllables; i++) units.push({ text: "+", word: joined });
  }
  return { units, unparsed: [] };
}

export function splitLyrics(language: string, text: string): { units: LyricUnit[]; unparsed: string[] } {
  if (language === "ja") return splitJapanese(text);
  if (language === "en") return splitEnglish(text);
  // Other languages: one whitespace-separated token per note; the agent pre-splits syllables.
  return { units: text.split(/\s+/).filter(Boolean).map((t) => ({ text: t, word: t })), unparsed: [] };
}
