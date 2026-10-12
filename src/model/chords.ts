import { Chord, Note } from "tonal";

export interface ParsedChord {
  symbol: string;
  /** Pitch classes 0-11, root first. */
  root: number;
  bass: number;
  tones: number[];
}

export function parseChord(symbol: string): ParsedChord {
  const c = Chord.get(symbol.trim());
  if (c.empty || !c.tonic) {
    throw new RangeError(`Unknown chord "${symbol}" (examples: A, C#m, G#7, Dmaj7, F#m7, E/G#, Bsus4, D5)`);
  }
  const root = Note.chroma(c.tonic)!;
  const bass = c.bass ? Note.chroma(c.bass)! : root;
  const tones = [...new Set(c.notes.map((n: string) => Note.chroma(n)!))];
  // Root first, then the remaining tones in stacking order.
  const ordered = [root, ...tones.filter((t) => t !== root)];
  return { symbol: symbol.trim(), root, bass, tones: ordered };
}

const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
const NUMERALS = ["I", "II", "III", "IV", "V", "VI", "VII"];
const SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

export const ROMAN_PATTERN = /^(b|#)?(VII|VI|IV|V|III|II|I|vii|vi|iv|v|iii|ii|i)(.*)$/;

/**
 * Roman numeral in a major key → chord symbol. Upper case is major, lower case is minor;
 * the rest is a chord suffix ("7", "maj7", "sus4", "add9", "5"). "III7" in A → "C#7", "bVII" in A → "G".
 * For a minor key, write it relative to its major (vi = tonic) or use chord symbols directly.
 */
export function romanToChord(roman: string, keyTonic: string): string {
  const m = ROMAN_PATTERN.exec(roman.trim());
  if (!m) throw new RangeError(`Invalid roman numeral "${roman}" (examples: I, vi, IV, V7, III7, bVII, iim7)`);
  const [, accidental = "", numeral, suffix = ""] = m;
  const degree = NUMERALS.indexOf(numeral!.toUpperCase());
  const tonic = Note.chroma(keyTonic);
  if (tonic === undefined || Number.isNaN(tonic)) throw new RangeError(`Invalid key tonic "${keyTonic}"`);
  const pc = (tonic + MAJOR_STEPS[degree]! + (accidental === "#" ? 1 : accidental === "b" ? -1 : 0) + 12) % 12;
  const useFlats = /b/.test(keyTonic) || ["F"].includes(keyTonic) || accidental === "b";
  const name = (useFlats ? FLAT : SHARP)[pc]!;
  const minor = numeral === numeral!.toLowerCase();
  const quality = minor && !suffix.startsWith("m") && !suffix.startsWith("dim") ? "m" : "";
  return `${name}${quality}${suffix}`;
}

/** "A major" / "F# minor" / "C#m" → tonic of the relative major (for roman numerals) and mode. */
export function parseKey(key: string): { tonic: string; mode: "major" | "minor"; majorTonic: string } {
  const m = /^([A-Ga-g][#b]?)\s*(major|minor|maj|min|m)?$/i.exec(key.trim());
  if (!m) throw new RangeError(`Invalid key "${key}" (examples: "A major", "F# minor")`);
  const tonic = m[1]![0]!.toUpperCase() + m[1]!.slice(1);
  const mode = m[2] && /^m(in(or)?)?$/i.test(m[2]) ? "minor" : "major";
  const majorTonic = mode === "minor" ? Note.pitchClass(Note.transpose(tonic, "3m")) : tonic;
  return { tonic, mode, majorTonic };
}
