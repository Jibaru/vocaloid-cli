import type { CompiledChord, CompiledSection, CompiledSong, SectionKind } from "../model/compile.ts";
import { PPQ } from "../model/music.ts";
import type { BassPattern, DrumPattern, GuitarPattern, KeysPattern, PartSpec } from "./presets.ts";

/** A note ready to be written into song.yaml (positions as "bar:beat", durations in quarter notes). */
export interface GeneratedNote {
  at: string;
  pitch: number | string;
  dur: number;
  velocity: number;
}

interface Bar {
  bar: number;
  start: number;
  end: number;
  beats: number;
  beatTicks: number;
  section: CompiledSection;
  firstOfSection: boolean;
  lastOfSection: boolean;
  lastOfSong: boolean;
}

export interface ArrangeResult {
  notes: GeneratedNote[];
  warnings: string[];
}

const FALLBACK_SECTION = (song: CompiledSong): CompiledSection => ({ name: "song", kind: "verse", tick: 0, endTick: song.endTick });

export function chordAt(song: CompiledSong, tick: number): CompiledChord | undefined {
  let current: CompiledChord | undefined;
  for (const c of song.chords) {
    if (c.tick > tick) break;
    current = c;
  }
  return current && current.root >= 0 ? current : undefined;
}

function sectionAt(song: CompiledSong, tick: number): CompiledSection {
  let current: CompiledSection | undefined;
  for (const s of song.sections) {
    if (s.tick > tick) break;
    current = s;
  }
  return current ?? song.sections[0] ?? FALLBACK_SECTION(song);
}

function bars(song: CompiledSong, from: number, to: number): { bars: Bar[]; warnings: string[] } {
  const warnings: string[] = [];
  const out: Bar[] = [];
  const songEndBar = Number(song.grid.label(Math.max(0, song.endTick - 1)).split(":")[0]);
  let bar = Number(song.grid.label(from).split(":")[0]);
  for (;;) {
    const info = song.grid.info(bar);
    if (info.startTick >= to) break;
    if (info.denominator !== 4) {
      warnings.push(`bar ${bar}: ${info.numerator}/${info.denominator} is not supported by the generators yet; skipped`);
      bar++;
      continue;
    }
    const section = sectionAt(song, info.startTick);
    const next = song.grid.info(bar + 1).startTick;
    out.push({
      bar,
      start: info.startTick,
      end: next,
      beats: info.numerator,
      beatTicks: info.beatTicks,
      section,
      firstOfSection: info.startTick === section.tick,
      lastOfSection: next >= section.endTick,
      lastOfSong: bar >= songEndBar,
    });
    bar++;
  }
  return { bars: out, warnings };
}

/** Chord segments inside a bar: [start, end, chord]. */
function segments(song: CompiledSong, b: Bar): [number, number, CompiledChord][] {
  const points = [b.start, ...song.chords.filter((c) => c.tick > b.start && c.tick < b.end).map((c) => c.tick)];
  return points.flatMap((p, i) => {
    const chord = chordAt(song, p);
    return chord ? [[p, points[i + 1] ?? b.end, chord] as [number, number, CompiledChord]] : [];
  });
}

function placeIn(pc: number, low: number): number {
  return low + ((pc - (low % 12) + 12) % 12);
}

function emitter(song: CompiledSong, from: number, to: number) {
  const notes: GeneratedNote[] = [];
  const add = (tick: number, pitch: number | string, durTicks: number, velocity: number) => {
    if (tick < from || tick >= to) return;
    const dur = Math.max(30, Math.min(durTicks, to - tick));
    // Deterministic micro-variation keeps repeated hits from sounding like a machine gun.
    const jitter = ((tick / 120) % 3) - 1;
    notes.push({
      at: song.grid.label(tick),
      pitch,
      dur: Number((dur / PPQ).toFixed(3)),
      velocity: Math.max(1, Math.min(127, Math.round(velocity + jitter * 3))),
    });
  };
  return { notes, add };
}

function drums(song: CompiledSong, spec: Extract<PartSpec, { generator: "drums" }>, list: Bar[], from: number, to: number) {
  const { notes, add } = emitter(song, from, to);
  for (const b of list) {
    const pattern: DrumPattern = spec.patterns[b.section.kind];
    if (pattern === "none") continue;
    const q = b.beatTicks;
    const fill = b.lastOfSection && !b.lastOfSong && b.beats >= 4;
    const fillStart = fill ? b.start + (b.beats - 1) * q : b.end;
    for (let beat = 0; beat < b.beats; beat++) {
      const t = b.start + beat * q;
      const off = t + q / 2;
      if (t >= fillStart) break;
      const down = beat === 0;
      const crash = down && b.firstOfSection;
      switch (pattern) {
        case "rock":
          if (beat % 2 === 0) add(t, "kick", q / 2, down ? 112 : 100);
          if (beat === 2) add(off, "kick", q / 2, 92);
          if (beat % 2 === 1) add(t, "snare", q / 2, 108);
          add(t, crash ? "crash" : "hihat-closed", q / 2, crash ? 110 : 82);
          add(off, "hihat-closed", q / 2, 64);
          break;
        case "half":
          if (beat === 0) add(t, "kick", q / 2, 110);
          if (beat === 1) add(off, "kick", q / 2, 90);
          if (beat === 2) add(t, "snare", q / 2, 110);
          add(t, crash ? "crash" : "hihat-closed", q / 2, crash ? 108 : 78);
          add(off, "hihat-closed", q / 2, 60);
          break;
        case "four":
          add(t, "kick", q / 2, down ? 115 : 105);
          if (beat % 2 === 1) {
            add(t, "snare", q / 2, 106);
            add(t, "clap", q / 2, 80);
          }
          if (crash) add(t, "crash", q, 112);
          add(off, "hihat-open", q / 2, 78);
          break;
        case "sparse":
          if (beat === 0) add(t, crash ? "crash" : "kick", q, crash ? 95 : 96);
          if (beat === 2) add(t, "rim", q / 2, 70);
          add(t, "hihat-closed", q / 2, 58);
          break;
      }
    }
    if (fill) {
      // Last beat of the section: four 16th snares rising into the next downbeat.
      for (let i = 0; i < 4; i++) add(fillStart + (i * b.beatTicks) / 4, i < 2 ? "tom-high" : "snare", b.beatTicks / 4, 80 + i * 10);
    }
  }
  return notes;
}

function bass(song: CompiledSong, spec: Extract<PartSpec, { generator: "bass" }>, list: Bar[], from: number, to: number) {
  const { notes, add } = emitter(song, from, to);
  for (const b of list) {
    const pattern: BassPattern = spec.patterns[b.section.kind];
    if (pattern === "none") continue;
    const eighth = b.beatTicks / 2;
    for (const [start, end, chord] of segments(song, b)) {
      const root = placeIn(chord.bass, 33); // A1..G#2
      if (pattern === "whole") {
        add(start, root, end - start, 96);
        continue;
      }
      let i = 0;
      for (let t = start; t < end; t += eighth, i++) {
        const accent = (t - b.start) % b.beatTicks === 0 ? 106 : 94;
        if (pattern === "octaves") add(t, i % 2 === 0 ? root : root + 12, eighth * 0.9, accent);
        else if (pattern === "pulse") add(t, root, eighth * 0.6, (t - b.start) % b.beatTicks === 0 ? 92 : 104);
        else add(t, root, eighth * 0.9, accent);
      }
    }
  }
  return notes;
}

function powerChords(song: CompiledSong, spec: Extract<PartSpec, { generator: "power-chords" }>, list: Bar[], from: number, to: number) {
  const { notes, add } = emitter(song, from, to);
  for (const b of list) {
    const pattern: GuitarPattern = spec.patterns[b.section.kind];
    if (pattern === "none") continue;
    const eighth = b.beatTicks / 2;
    for (const [start, end, chord] of segments(song, b)) {
      const r = placeIn(chord.root, 40); // E2..D#3
      const voicing = [r, r + 7, r + 12];
      const hit = (t: number, d: number, v: number) => voicing.forEach((p) => add(t, p, d, v));
      switch (pattern) {
        case "sustain":
          hit(start, end - start, 86);
          break;
        case "hit":
          if (start === b.start) hit(start, b.end - b.start, 110);
          break;
        default:
          for (let t = start; t < end; t += eighth) {
            const down = (t - b.start) % b.beatTicks === 0;
            if (pattern === "mute8") hit(t, eighth * 0.4, down ? 88 : 76);
            else if (pattern === "open8") hit(t, eighth * 0.9, down ? 96 : 86);
            else hit(t, eighth, down ? 112 : 100);
          }
      }
    }
  }
  return notes;
}

function keys(song: CompiledSong, spec: Extract<PartSpec, { generator: "keys" }>, list: Bar[], from: number, to: number) {
  const { notes, add } = emitter(song, from, to);
  for (const b of list) {
    const pattern: KeysPattern = spec.patterns[b.section.kind];
    if (pattern === "none") continue;
    const q = b.beatTicks;
    for (const [start, end, chord] of segments(song, b)) {
      const voicing = chord.tones.map((pc) => placeIn(pc, 55)).sort((x, y) => x - y); // around G3..F#4
      switch (pattern) {
        case "pad":
          for (const p of voicing) add(start, p, end - start, 68);
          break;
        case "block":
          for (let t = start; t < end; t += q) for (const p of voicing) add(t, p, q * 0.9, 78);
          break;
        case "stabs":
          for (let t = start + q / 2; t < end; t += q) for (const p of voicing) add(t, p, q / 4, 90);
          break;
        case "arp": {
          const base = placeIn(chord.root, 48);
          const up = [...new Set([base, ...chord.tones.map((pc) => placeIn(pc, base + 1)), base + 12])].sort((x, y) => x - y);
          const cycle = [...up, ...up.slice(1, -1).reverse()];
          let i = 0;
          for (let t = start; t < end; t += q / 2, i++) add(t, cycle[i % cycle.length]!, q * 0.95, i % 4 === 0 ? 84 : 70);
          break;
        }
      }
    }
  }
  return notes;
}

/** Generate one part between [from, to) ticks. Requires chords (except drums). */
export function generatePart(song: CompiledSong, spec: PartSpec, from: number, to: number): ArrangeResult {
  const { bars: list, warnings } = bars(song, from, to);
  let notes: GeneratedNote[];
  switch (spec.generator) {
    case "drums":
      notes = drums(song, spec, list, from, to);
      break;
    case "bass":
      notes = bass(song, spec, list, from, to);
      break;
    case "power-chords":
      notes = powerChords(song, spec, list, from, to);
      break;
    case "keys":
      notes = keys(song, spec, list, from, to);
      break;
  }
  return { notes, warnings };
}

export type { SectionKind };
