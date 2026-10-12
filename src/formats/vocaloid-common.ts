import type { CompiledVocalTrack } from "../model/compile.ts";
import { kanaToRomaji } from "./kana.ts";
import { ROMAJI_TO_XSAMPA } from "./vocaloid-ja-phonemes.ts";

export const LANG_ID: Record<string, number> = { ja: 0, en: 1, ko: 2, es: 3, zh: 4 };

/** VOCALOID's default phoneme when we cannot derive one (the editor can re-convert). */
const FALLBACK_PHONEME = "a";

export interface VocaloidNoteText {
  lyric: string;
  phoneme: string;
  /** true when we derived a real phoneme; false means "please re-convert in the editor". */
  derived: boolean;
}

/**
 * Lyric + phoneme for VOCALOID. "+" (our continuation) becomes VOCALOID's legato "-".
 * Japanese kana/romaji → X-SAMPA via the LibreSVIP table; other languages keep the lyric and get a
 * placeholder phoneme the editor regenerates with Job → "Convert Phonemes to Match Language".
 */
export function vocaloidText(language: string, lyric: string, phonemes?: string): VocaloidNoteText {
  if (lyric.startsWith("+")) return { lyric: "-", phoneme: "-", derived: true };
  if (phonemes) return { lyric, phoneme: phonemes, derived: true };
  if (language === "ja") {
    const romaji = kanaToRomaji(lyric) ?? lyric.toLowerCase();
    const xsampa = ROMAJI_TO_XSAMPA[romaji];
    if (xsampa) return { lyric, phoneme: xsampa, derived: true };
  }
  return { lyric, phoneme: FALLBACK_PHONEME, derived: false };
}

/** Our curves → VOCALOID controller values. Returns null for curves with no verified mapping. */
export function dynamicsToVocaloid(value: number): number {
  return Math.max(0, Math.min(127, Math.round(64 + value * 0.63)));
}

export function breathinessToVocaloid(value: number): number {
  return Math.max(0, Math.min(127, Math.round(Math.max(0, value) * 1.27)));
}

/** Pitch bend in cents → (PIT, PBS). PBS in semitones grows to cover the largest bend. */
export function pitchBendSensitivity(track: CompiledVocalTrack): number {
  const maxCents = Math.max(0, ...(track.curves.pitchBend ?? []).map((p) => Math.abs(p.value)));
  return Math.min(24, Math.max(2, Math.ceil(maxCents / 100)));
}

export function centsToPit(cents: number, pbs: number): number {
  return Math.max(-8192, Math.min(8191, Math.round((cents / (pbs * 100)) * 8192)));
}

export function unsupportedCurves(track: CompiledVocalTrack): string[] {
  return (["gender", "tension", "voicing"] as const).filter((c) => (track.curves[c]?.length ?? 0) > 0);
}
