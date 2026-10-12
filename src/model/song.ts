import { z } from "zod";

/**
 * song.yaml, schema version 1. This is the published contract agents write against.
 * Keep field names stable; add, never rename. `vocaloid schema song` prints it as JSON Schema.
 */

export const SONG_SCHEMA_VERSION = 1;

const Position = z
  .union([z.number().min(0), z.string().regex(/^\d+:\d+(\.\d+)?$/)])
  .describe('Quarter notes from song start (number), or 1-based "bar:beat" like "5:2.5"');

const Duration = z
  .union([z.number().positive(), z.string().regex(/^\d+(\.\d+)?\/\d+$/)])
  .describe('Quarter notes (number), or fraction of a whole note like "1/8"');

const Pitch = z
  .union([z.number().int().min(0).max(127), z.string()])
  .describe("Scientific pitch name (C4 = MIDI 60 = middle C) or MIDI number");

const CurvePoint = z.object({
  at: Position,
  value: z.number(),
});

export const CURVE_NAMES = [
  "dynamics",
  "pitchBend",
  "breathiness",
  "gender",
  "tension",
  "voicing",
] as const;

const Curves = z
  .object({
    dynamics: z.array(CurvePoint).optional().describe("Loudness, -100..100, 0 = neutral"),
    pitchBend: z.array(CurvePoint).optional().describe("Pitch deviation in cents, -1200..1200"),
    breathiness: z.array(CurvePoint).optional().describe("-100..100, 0 = neutral"),
    gender: z.array(CurvePoint).optional().describe("Formant shift, -100 (deeper) .. 100 (younger/brighter)"),
    tension: z.array(CurvePoint).optional().describe("-100 (soft) .. 100 (tense), DiffSinger voices that support it"),
    voicing: z.array(CurvePoint).optional().describe("0..100, 100 = fully voiced"),
  })
  .strict()
  .describe("Automation curves; points are linearly interpolated");

const Vibrato = z
  .object({
    depth: z.number().min(5).max(200).default(25).describe("Cents"),
    period: z.number().min(5).max(500).default(175).describe("Milliseconds per cycle"),
    length: z.number().min(0).max(100).default(60).describe("Percent of the note, measured from its end"),
    fadeIn: z.number().min(0).max(100).default(10),
    fadeOut: z.number().min(0).max(100).default(10),
  })
  .strict();

export const VocalNote = z
  .object({
    at: Position,
    pitch: Pitch,
    dur: Duration,
    lyric: z
      .string()
      .min(1)
      .describe('Japanese: one mora per note (hiragana or romaji). English: whole word on the first note, "+" on continuation notes. "+" (any language) continues the previous note and must start exactly where it ends.'),
    phonemes: z.string().optional().describe('Override phonemes, space-separated in the voice\'s symbol set, e.g. "k a"'),
    vibrato: Vibrato.optional(),
    velocity: z.number().min(0).max(200).optional().describe("Consonant speed, 100 = normal"),
    voiceColor: z.string().optional().describe("Per-note voice color (e.g. Hanami: Root, Fragrance, Nectar)"),
  })
  .strict();

export const InstrumentNote = z
  .object({
    at: Position,
    pitch: Pitch.describe("Pitch, or on drum tracks a drum name like kick, snare, hihat-closed"),
    dur: Duration,
    velocity: z.number().int().min(1).max(127).default(100),
  })
  .strict();

const TrackBase = {
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/).describe("Unique slug, used for stems and commands"),
  name: z.string().optional(),
  volume: z.number().min(-60).max(12).default(0).describe("Gain in dB"),
  pan: z.number().min(-100).max(100).default(0),
  mute: z.boolean().default(false),
  fx: z
    .enum(["auto", "none", "vocal", "room"])
    .default("auto")
    .describe("Effect chain: auto = vocal on vocal tracks, none on instruments; vocal = highpass + compressor + short reverb; room = light reverb"),
};

export const VocalTrack = z
  .object({
    ...TrackBase,
    kind: z.literal("vocal"),
    voice: z.string().describe("Voice id from `vocaloid voice list`"),
    language: z.enum(["ja", "en", "es", "ko", "zh", "de"]).describe("Lyric language for this track"),
    voiceColor: z.string().optional().describe("Default voice color for the track"),
    notes: z.array(VocalNote).default([]),
    curves: Curves.optional(),
  })
  .strict();

export const InstrumentTrack = z
  .object({
    ...TrackBase,
    kind: z.literal("instrument"),
    instrument: z
      .union([z.string(), z.number().int().min(0).max(127)])
      .describe('General MIDI program name (e.g. "distortion_guitar") or number, or "drums"'),
    notes: z.array(InstrumentNote).default([]).describe("Explicit notes; added on top of generated ones"),
    generate: z
      .object({
        part: z.string().describe("Part id of the style preset, e.g. drums, bass, guitar-l"),
        style: z.string().optional().describe("Defaults to the song's style"),
      })
      .strict()
      .optional()
      .describe("Generate this track's accompaniment from chords + sections at render time (`vocaloid arrange`)"),
  })
  .strict();

export const Track = z.discriminatedUnion("kind", [VocalTrack, InstrumentTrack]);

export const SECTION_KINDS = ["intro", "verse", "pre", "chorus", "bridge", "drop", "interlude", "outro"] as const;

const Section = z
  .object({
    name: z.string().min(1),
    at: Position,
    kind: z
      .enum(SECTION_KINDS)
      .optional()
      .describe("Drives `vocaloid arrange` patterns. Inferred from the name when omitted (A→verse, B→pre, サビ/hook→chorus)"),
  })
  .strict();

const ChordChange = z
  .object({
    at: Position,
    chord: z.string().min(1).describe('Chord symbol (A, C#m, G#7, Dmaj7, E/G#, Bsus4, D5) or "N.C." for no chord. Lasts until the next change'),
  })
  .strict();

export const Song = z
  .object({
    schemaVersion: z.literal(SONG_SCHEMA_VERSION),
    title: z.string().min(1),
    artist: z.string().optional(),
    key: z.string().optional().describe('Informational, e.g. "A major", "F# minor"'),
    tempo: z
      .union([
        z.number().min(20).max(400),
        z.array(z.object({ at: Position, bpm: z.number().min(20).max(400) }).strict()).min(1),
      ])
      .describe("BPM, or a tempo map whose first point is at 0"),
    timeSignature: z
      .union([
        z.string(),
        z.array(z.object({ bar: z.number().int().min(1), sig: z.string() }).strict()).min(1),
      ])
      .default("4/4"),
    style: z.string().optional().describe("Style preset id from `vocaloid style list`; default patterns for `arrange`"),
    sections: z.array(Section).optional().describe("Song structure; each section lasts until the next one or `end`"),
    chords: z.array(ChordChange).optional().describe("Harmony track used by `vocaloid arrange`"),
    end: Position.optional().describe("Song end; defaults to the last note. Arrangements fill up to here"),
    tracks: z.array(Track).default([]),
  })
  .strict();

export type SongInput = z.input<typeof Song>;
export type SongData = z.output<typeof Song>;
export type VocalTrackData = z.output<typeof VocalTrack>;
export type InstrumentTrackData = z.output<typeof InstrumentTrack>;
export type TrackData = z.output<typeof Track>;
export type VocalNoteData = z.output<typeof VocalNote>;
export type InstrumentNoteData = z.output<typeof InstrumentNote>;
export type CurveName = (typeof CURVE_NAMES)[number];
