import type { SectionKind } from "../model/compile.ts";

/**
 * Style presets are data: tempo, form, progressions per section, and the instrument parts with
 * the generator each one uses per section kind. The agent writes melody and lyrics; presets only
 * do the mechanical accompaniment. Facts behind jrock-vocaloid are in skills/vocaloid/composing.md.
 */

export type DrumPattern = "rock" | "half" | "four" | "sparse" | "none";
export type BassPattern = "eighths" | "octaves" | "whole" | "pulse" | "none";
export type GuitarPattern = "mute8" | "open8" | "drive8" | "sustain" | "hit" | "none";
export type KeysPattern = "pad" | "stabs" | "arp" | "block" | "none";

export type PartSpec =
  | { id: string; generator: "drums"; instrument: "drums"; volume: number; pan: number; patterns: Record<SectionKind, DrumPattern> }
  | { id: string; generator: "bass"; instrument: string; volume: number; pan: number; patterns: Record<SectionKind, BassPattern> }
  | { id: string; generator: "power-chords"; instrument: string; volume: number; pan: number; patterns: Record<SectionKind, GuitarPattern> }
  | { id: string; generator: "keys"; instrument: string; volume: number; pan: number; patterns: Record<SectionKind, KeysPattern> };

export interface StylePreset {
  id: string;
  name: string;
  description: string;
  tempo: { min: number; max: number; default: number };
  defaultKey: string;
  form: { name: string; kind: SectionKind; bars: number }[];
  /** Roman numerals in the major key (relative major for minor keys); one chord per bar, looped. */
  progressions: Record<SectionKind, string[]>;
  vocal: { range: string; voiceColors: Partial<Record<SectionKind, string>> };
  parts: PartSpec[];
  tips: string[];
}

const all = <T>(value: T, overrides: Partial<Record<SectionKind, T>> = {}): Record<SectionKind, T> => ({
  intro: value,
  verse: value,
  pre: value,
  chorus: value,
  bridge: value,
  drop: value,
  interlude: value,
  outro: value,
  ...overrides,
});

export const STYLES: StylePreset[] = [
  {
    id: "jrock-vocaloid",
    name: "J-rock vocaloid (DECO*27-like)",
    description:
      "Fast dance-rock: half-time verses, royal-road pre-chorus, four-on-the-floor Marunouchi chorus, distorted guitars L/R, octave bass.",
    tempo: { min: 160, max: 210, default: 180 },
    defaultKey: "A major",
    form: [
      { name: "intro", kind: "intro", bars: 8 },
      { name: "A", kind: "verse", bars: 16 },
      { name: "B", kind: "pre", bars: 8 },
      { name: "chorus", kind: "chorus", bars: 16 },
      { name: "A2", kind: "verse", bars: 8 },
      { name: "B2", kind: "pre", bars: 8 },
      { name: "chorus2", kind: "chorus", bars: 16 },
      { name: "bridge", kind: "bridge", bars: 8 },
      { name: "last chorus", kind: "chorus", bars: 16 },
      { name: "outro", kind: "outro", bars: 4 },
    ],
    progressions: {
      intro: ["vi", "IV", "V", "I"],
      verse: ["vi", "iii", "IV", "III"],
      pre: ["IV", "V", "iii", "vi"],
      chorus: ["IV", "III7", "vi", "I"],
      bridge: ["ii", "V", "iii", "vi"],
      drop: ["vi", "vi", "IV", "V"],
      interlude: ["vi", "IV", "V", "I"],
      outro: ["IV", "V", "vi", "vi"],
    },
    vocal: { range: "A3-E5", voiceColors: { chorus: "Fragrance", bridge: "Nectar" } },
    parts: [
      { id: "drums", generator: "drums", instrument: "drums", volume: -3, pan: 0, patterns: all<DrumPattern>("rock", { verse: "half", chorus: "four", bridge: "half", drop: "half" }) },
      { id: "bass", generator: "bass", instrument: "electric_bass_pick", volume: -5, pan: 0, patterns: all<BassPattern>("eighths", { chorus: "octaves", bridge: "whole", drop: "whole" }) },
      { id: "guitar-l", generator: "power-chords", instrument: "distortion_guitar", volume: -9, pan: -45, patterns: all<GuitarPattern>("open8", { verse: "mute8", chorus: "drive8", bridge: "sustain", drop: "sustain", outro: "hit" }) },
      { id: "guitar-r", generator: "power-chords", instrument: "overdriven_guitar", volume: -10, pan: 45, patterns: all<GuitarPattern>("open8", { verse: "mute8", chorus: "drive8", bridge: "sustain", drop: "sustain", outro: "hit" }) },
      { id: "synth", generator: "keys", instrument: "pad_3_polysynth", volume: -14, pan: 15, patterns: all<KeysPattern>("pad", { verse: "none", chorus: "stabs", intro: "stabs" }) },
    ],
    tips: [
      "Verses: dense 16th-note syllables, mostly A3-C#5; choruses jump up, peaking D5-E5.",
      "Use voiceColor Fragrance on choruses; a 'ra-ra-ra' chant hook in the intro works well.",
      "Raise the last chorus a half step by transposing chords and melody (edit both).",
    ],
  },
  {
    id: "idol-pop",
    name: "Idol pop",
    description: "Bright four-on-the-floor pop: piano/synth stabs, pulsing synth bass, light guitar.",
    tempo: { min: 130, max: 160, default: 145 },
    defaultKey: "C major",
    form: [
      { name: "intro", kind: "intro", bars: 4 },
      { name: "A", kind: "verse", bars: 8 },
      { name: "B", kind: "pre", bars: 8 },
      { name: "chorus", kind: "chorus", bars: 8 },
      { name: "A2", kind: "verse", bars: 8 },
      { name: "B2", kind: "pre", bars: 8 },
      { name: "chorus2", kind: "chorus", bars: 8 },
      { name: "bridge", kind: "bridge", bars: 8 },
      { name: "last chorus", kind: "chorus", bars: 16 },
      { name: "outro", kind: "outro", bars: 4 },
    ],
    progressions: all(["IV", "V", "iii", "vi"], { verse: ["I", "V", "vi", "IV"], bridge: ["ii", "iii", "IV", "V"], outro: ["IV", "V", "I", "I"] }),
    vocal: { range: "C4-D5", voiceColors: { chorus: "Fragrance", verse: "Root" } },
    parts: [
      { id: "drums", generator: "drums", instrument: "drums", volume: -4, pan: 0, patterns: all<DrumPattern>("four", { intro: "sparse", bridge: "half" }) },
      { id: "bass", generator: "bass", instrument: "synth_bass_1", volume: -6, pan: 0, patterns: all<BassPattern>("pulse", { bridge: "whole" }) },
      { id: "keys", generator: "keys", instrument: "electric_piano_1", volume: -9, pan: -20, patterns: all<KeysPattern>("stabs", { verse: "block", bridge: "pad" }) },
      { id: "pad", generator: "keys", instrument: "pad_2_warm", volume: -16, pan: 20, patterns: all<KeysPattern>("pad", { verse: "none" }) },
    ],
    tips: ["Keep the hook in the middle of the range; idol choruses are singable, not acrobatic."],
  },
  {
    id: "ballad",
    name: "Piano ballad",
    description: "Slow piano arpeggios, warm pad, soft half-time drums from the second verse.",
    tempo: { min: 66, max: 92, default: 78 },
    defaultKey: "E major",
    form: [
      { name: "intro", kind: "intro", bars: 4 },
      { name: "A", kind: "verse", bars: 8 },
      { name: "B", kind: "pre", bars: 4 },
      { name: "chorus", kind: "chorus", bars: 8 },
      { name: "A2", kind: "verse", bars: 8 },
      { name: "chorus2", kind: "chorus", bars: 8 },
      { name: "bridge", kind: "bridge", bars: 4 },
      { name: "last chorus", kind: "chorus", bars: 8 },
      { name: "outro", kind: "outro", bars: 4 },
    ],
    progressions: all(["I", "V", "vi", "IV"], { pre: ["ii", "iii", "IV", "V"], bridge: ["vi", "IV", "ii", "V"] }),
    vocal: { range: "B3-C#5", voiceColors: { verse: "Nectar", chorus: "Root" } },
    parts: [
      { id: "piano", generator: "keys", instrument: "acoustic_grand_piano", volume: -6, pan: -10, patterns: all<KeysPattern>("arp", { outro: "pad" }) },
      { id: "pad", generator: "keys", instrument: "string_ensemble_1", volume: -14, pan: 10, patterns: all<KeysPattern>("pad", { intro: "none", verse: "none" }) },
      { id: "bass", generator: "bass", instrument: "acoustic_bass", volume: -9, pan: 0, patterns: all<BassPattern>("whole", { intro: "none" }) },
      { id: "drums", generator: "drums", instrument: "drums", volume: -10, pan: 0, patterns: all<DrumPattern>("half", { intro: "none", verse: "sparse", outro: "none" }) },
    ],
    tips: ["Leave space: long notes with vibrato on phrase ends, Nectar for verses."],
  },
];

export function findStyle(id: string): StylePreset | undefined {
  return STYLES.find((s) => s.id === id);
}
