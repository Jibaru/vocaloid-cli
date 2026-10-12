import type { Voice } from "../catalog/registry.ts";
import { DRUMS, resolveInstrument } from "../catalog/instruments.ts";
import type { ErrorDetail } from "../lib/errors.ts";
import {
  BarGrid,
  type TempoPoint,
  type TimeSignature,
  durationTicks,
  parseDrum,
  parsePitch,
  parseTimeSignature,
  positionTicks,
} from "./music.ts";
import { generatePart } from "../styles/generate.ts";
import { findStyle } from "../styles/presets.ts";
import { type ParsedChord, parseChord } from "./chords.ts";
import { CURVE_NAMES, type CurveName, SECTION_KINDS, type SongData } from "./song.ts";

export type SectionKind = (typeof SECTION_KINDS)[number];

/** Infer a section's role from its name: A/verse, B/pre, サビ/chorus/hook, and so on. */
export function inferSectionKind(name: string): SectionKind {
  const n = name.trim().toLowerCase();
  if (/intro|イントロ/.test(n)) return "intro";
  if (/outro|ending|アウトロ/.test(n)) return "outro";
  if (/pre|^b\d*$|^b[- ]|bメロ/.test(n)) return "pre";
  if (/chorus|hook|サビ|^c\d*$|^s\d*$/.test(n)) return "chorus";
  if (/bridge|^d\d*$|cメロ|間奏前/.test(n)) return "bridge";
  if (/drop|break/.test(n)) return "drop";
  if (/interlude|solo|間奏/.test(n)) return "interlude";
  return "verse";
}

export interface CompiledVocalNote {
  index: number;
  tick: number;
  dur: number;
  midi: number;
  lyric: string;
  phonemes?: string;
  vibrato?: { depth: number; period: number; length: number; fadeIn: number; fadeOut: number };
  velocity?: number;
  voiceColor?: string;
}

export interface CompiledInstrumentNote {
  index: number;
  tick: number;
  dur: number;
  midi: number;
  velocity: number;
}

interface CompiledTrackBase {
  index: number;
  fx: "none" | "vocal" | "room";
  id: string;
  name: string;
  volume: number;
  pan: number;
  mute: boolean;
}

export interface CompiledVocalTrack extends CompiledTrackBase {
  kind: "vocal";
  voice: Voice;
  language: string;
  voiceColor?: string;
  notes: CompiledVocalNote[];
  curves: Partial<Record<CurveName, { tick: number; value: number }[]>>;
}

export interface CompiledInstrumentTrack extends CompiledTrackBase {
  kind: "instrument";
  generated?: { style: string; part: string; notes: number };
  program: number | typeof DRUMS;
  instrument: string | number;
  notes: CompiledInstrumentNote[];
}

export type CompiledTrack = CompiledVocalTrack | CompiledInstrumentTrack;

export interface CompiledChord extends ParsedChord {
  tick: number;
  index: number;
}

export interface CompiledSection {
  name: string;
  kind: SectionKind;
  tick: number;
  endTick: number;
}

export interface CompiledSong {
  title: string;
  style?: string;
  chords: CompiledChord[];
  artist?: string;
  key?: string;
  tempos: TempoPoint[];
  timeSignatures: TimeSignature[];
  grid: BarGrid;
  sections: CompiledSection[];
  tracks: CompiledTrack[];
  endTick: number;
}

const CURVE_RANGES: Record<CurveName, [number, number]> = {
  dynamics: [-100, 100],
  pitchBend: [-1200, 1200],
  breathiness: [-100, 100],
  gender: [-100, 100],
  tension: [-100, 100],
  voicing: [0, 100],
};

/**
 * Semantic validation on top of the Zod schema. Collects every problem with a JSON path so an
 * agent can fix them all in one pass instead of one error per run.
 */
export function compileSong(
  song: SongData,
  voices: Voice[],
): { song?: CompiledSong; errors: ErrorDetail[]; warnings: string[] } {
  const errors: ErrorDetail[] = [];
  const warnings: string[] = [];
  const attempt = <T>(path: string, fn: () => T): T | undefined => {
    try {
      return fn();
    } catch (e) {
      errors.push({ path, message: e instanceof Error ? e.message : String(e) });
      return undefined;
    }
  };

  const timeSignatures: TimeSignature[] = [];
  const sigInput =
    typeof song.timeSignature === "string" ? [{ bar: 1, sig: song.timeSignature }] : song.timeSignature;
  sigInput.forEach((s, i) => {
    const parsed = attempt(`timeSignature[${i}].sig`, () => parseTimeSignature(s.sig));
    if (parsed) timeSignatures.push({ bar: s.bar, ...parsed });
  });
  if (timeSignatures[0] && timeSignatures[0].bar !== 1) {
    errors.push({ path: "timeSignature[0].bar", message: "The first time signature must start at bar 1" });
  }
  const grid = new BarGrid(timeSignatures);

  const tempos: TempoPoint[] = [];
  if (typeof song.tempo === "number") {
    tempos.push({ tick: 0, bpm: song.tempo });
  } else {
    song.tempo.forEach((t, i) => {
      const tick = attempt(`tempo[${i}].at`, () => positionTicks(t.at, grid));
      if (tick !== undefined) tempos.push({ tick, bpm: t.bpm });
    });
    tempos.sort((a, b) => a.tick - b.tick);
    if (tempos[0]?.tick !== 0) errors.push({ path: "tempo[0].at", message: "The tempo map must start at position 0 (\"1:1\")" });
  }

  const rawSections = (song.sections ?? []).flatMap((s, i) => {
    const tick = attempt(`sections[${i}].at`, () => positionTicks(s.at, grid));
    return tick === undefined ? [] : [{ name: s.name, kind: s.kind ?? inferSectionKind(s.name), tick }];
  });
  rawSections.sort((a, b) => a.tick - b.tick);

  const chords: CompiledChord[] = [];
  (song.chords ?? []).forEach((c, i) => {
    const tick = attempt(`chords[${i}].at`, () => positionTicks(c.at, grid));
    if (tick === undefined) return;
    if (/^n\.?c\.?$/i.test(c.chord.trim())) {
      chords.push({ index: i, tick, symbol: "N.C.", root: -1, bass: -1, tones: [] });
      return;
    }
    const parsed = attempt(`chords[${i}].chord`, () => parseChord(c.chord));
    if (parsed) chords.push({ index: i, tick, ...parsed });
  });
  chords.sort((a, b) => a.tick - b.tick);
  const explicitEnd = song.end === undefined ? undefined : attempt("end", () => positionTicks(song.end!, grid));

  const ids = new Set<string>();
  const tracks: CompiledTrack[] = [];
  let endTick = 0;

  song.tracks.forEach((track, ti) => {
    const base = `tracks[${ti}]`;
    if (ids.has(track.id)) errors.push({ path: `${base}.id`, message: `Duplicate track id "${track.id}"` });
    ids.add(track.id);
    const common = {
      index: ti,
      id: track.id,
      name: track.name ?? track.id,
      volume: track.volume,
      pan: track.pan,
      mute: track.mute,
      fx: track.fx === "auto" ? (track.kind === "vocal" ? ("vocal" as const) : ("none" as const)) : track.fx,
    };

    if (track.kind === "vocal") {
      const voice = voices.find((v) => v.id === track.voice);
      if (!voice) {
        errors.push({
          path: `${base}.voice`,
          message: `Unknown voice "${track.voice}". Available: ${voices.map((v) => v.id).join(", ")}`,
        });
      } else {
        if (!voice.phonemizers[track.language as keyof typeof voice.phonemizers]) {
          errors.push({
            path: `${base}.language`,
            message: `Voice "${voice.id}" does not support language "${track.language}". Supported: ${Object.keys(voice.phonemizers).join(", ")}`,
          });
        }
        const checkColor = (path: string, color?: string) => {
          if (color && !voice.voiceColors.includes(color)) {
            errors.push({ path, message: `Unknown voice color "${color}". Available: ${voice.voiceColors.join(", ") || "(none)"}` });
          }
        };
        checkColor(`${base}.voiceColor`, track.voiceColor);
        track.notes.forEach((n, ni) => checkColor(`${base}.notes[${ni}].voiceColor`, n.voiceColor));
      }

      const notes: CompiledVocalNote[] = [];
      track.notes.forEach((n, ni) => {
        const p = `${base}.notes[${ni}]`;
        const tick = attempt(`${p}.at`, () => positionTicks(n.at, grid));
        const dur = attempt(`${p}.dur`, () => durationTicks(n.dur));
        const midi = attempt(`${p}.pitch`, () => parsePitch(n.pitch));
        if (tick === undefined || dur === undefined || midi === undefined) return;
        notes.push({
          index: ni,
          tick,
          dur,
          midi,
          lyric: n.lyric,
          phonemes: n.phonemes,
          vibrato: n.vibrato,
          velocity: n.velocity,
          voiceColor: n.voiceColor,
        });
      });
      notes.sort((a, b) => a.tick - b.tick);
      // Voices are monophonic: overlapping notes on one track cannot be sung.
      for (let i = 1; i < notes.length; i++) {
        const prev = notes[i - 1]!;
        const cur = notes[i]!;
        if (cur.tick < prev.tick + prev.dur) {
          errors.push({
            path: `${base}.notes[${cur.index}]`,
            message: `Overlaps notes[${prev.index}] (at ${grid.label(prev.tick)}). Vocal tracks are monophonic; shorten notes[${prev.index}] or move this note.`,
          });
        }
      }
      // OpenUtau only treats "+" as a continuation when it starts exactly where the previous note ends.
      for (let i = 0; i < notes.length; i++) {
        const cur = notes[i]!;
        if (!cur.lyric.startsWith("+")) continue;
        const prev = notes[i - 1];
        if (!prev || prev.tick + prev.dur !== cur.tick) {
          errors.push({
            path: `${base}.notes[${cur.index}].lyric`,
            message: `"+" continues the previous note, so it must start exactly where that note ends${prev ? ` (${grid.label(prev.tick + prev.dur)})` : ""}; got ${grid.label(cur.tick)}`,
          });
        }
      }

      const curves: CompiledVocalTrack["curves"] = {};
      for (const name of CURVE_NAMES) {
        const points = track.curves?.[name];
        if (!points) continue;
        const [min, max] = CURVE_RANGES[name];
        const compiled = points.flatMap((pt, pi) => {
          const p = `${base}.curves.${name}[${pi}]`;
          if (pt.value < min || pt.value > max) {
            errors.push({ path: `${p}.value`, message: `${name} must be within ${min}..${max}, got ${pt.value}` });
          }
          const tick = attempt(`${p}.at`, () => positionTicks(pt.at, grid));
          return tick === undefined ? [] : [{ tick, value: pt.value }];
        });
        curves[name] = compiled.sort((a, b) => a.tick - b.tick);
      }

      const last = notes.at(-1);
      if (last) endTick = Math.max(endTick, last.tick + last.dur);
      if (voice) {
        tracks.push({
          ...common,
          kind: "vocal",
          voice,
          language: track.language,
          voiceColor: track.voiceColor,
          notes,
          curves,
        });
      }
    } else {
      const program = attempt(`${base}.instrument`, () => resolveInstrument(track.instrument));
      const notes: CompiledInstrumentNote[] = [];
      track.notes.forEach((n, ni) => {
        const p = `${base}.notes[${ni}]`;
        const tick = attempt(`${p}.at`, () => positionTicks(n.at, grid));
        const dur = attempt(`${p}.dur`, () => durationTicks(n.dur));
        const midi = attempt(`${p}.pitch`, () =>
          program === DRUMS ? parseDrum(n.pitch) : parsePitch(n.pitch),
        );
        if (tick === undefined || dur === undefined || midi === undefined) return;
        notes.push({ index: ni, tick, dur, midi, velocity: n.velocity });
      });
      notes.sort((a, b) => a.tick - b.tick || a.midi - b.midi);
      for (const n of notes) endTick = Math.max(endTick, n.tick + n.dur);
      if (program !== undefined) {
        tracks.push({ ...common, kind: "instrument", program, instrument: track.instrument, notes });
      }
    }
  });

  // The song ends at `end`, else at the last note or one bar after the last chord change.
  const lastChord = chords.at(-1);
  if (lastChord) endTick = Math.max(endTick, lastChord.tick + grid.info(Number(grid.label(lastChord.tick).split(":")[0])).barTicks);
  if (explicitEnd !== undefined) {
    if (explicitEnd < endTick) warnings.push(`end (${grid.label(explicitEnd)}) is before the last note/chord (${grid.label(endTick)}); notes after it still play`);
    endTick = Math.max(endTick, explicitEnd);
  }
  const sections: CompiledSection[] = rawSections.map((s, i) => ({
    ...s,
    endTick: rawSections[i + 1]?.tick ?? Math.max(endTick, s.tick),
  }));

  if (errors.length > 0) return { errors, warnings };
  const compiled: CompiledSong = {
    title: song.title,
    style: song.style,
    chords,
    artist: song.artist,
    key: song.key,
    tempos,
    timeSignatures: [...grid.signatures],
    grid,
    sections,
    tracks,
    endTick,
  };
  expandGenerated(compiled, song, errors, warnings);
  if (errors.length > 0) return { errors, warnings };
  return { song: compiled, errors, warnings };
}

/** Tracks with `generate` get their accompaniment from the style preset, over the whole song. */
function expandGenerated(compiled: CompiledSong, song: SongData, errors: ErrorDetail[], warnings: string[]): void {
  song.tracks.forEach((track, ti) => {
    if (track.kind !== "instrument" || !track.generate) return;
    const base = `tracks[${ti}].generate`;
    const styleId = track.generate.style ?? song.style;
    const style = styleId ? findStyle(styleId) : undefined;
    if (!style) {
      errors.push({ path: `${base}.style`, message: styleId ? `Unknown style "${styleId}"` : "No style: set `style` on the song or on generate" });
      return;
    }
    const part = style.parts.find((p) => p.id === track.generate!.part);
    if (!part) {
      errors.push({ path: `${base}.part`, message: `Style ${style.id} has no part "${track.generate.part}". Parts: ${style.parts.map((p) => p.id).join(", ")}` });
      return;
    }
    if (part.generator !== "drums" && compiled.chords.length === 0) {
      errors.push({ path: base, message: `Part "${part.id}" needs chords; add \`chords:\` to the song` });
      return;
    }
    const target = compiled.tracks.find((t) => t.index === ti);
    if (!target || target.kind !== "instrument") return;
    const result = generatePart(compiled, part, 0, compiled.endTick);
    warnings.push(...result.warnings.map((w) => `${base}: ${w}`));
    const generated: CompiledInstrumentNote[] = result.notes.map((n) => ({
      index: -1,
      tick: positionTicks(n.at, compiled.grid),
      dur: durationTicks(n.dur),
      midi: typeof n.pitch === "number" ? n.pitch : parseDrum(n.pitch),
      velocity: n.velocity,
    }));
    target.notes = [...generated, ...target.notes].sort((a, b) => a.tick - b.tick || a.midi - b.midi);
    target.generated = { style: style.id, part: part.id, notes: generated.length };
  });
}
