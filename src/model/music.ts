/**
 * Musical primitives shared by every adapter.
 *
 * Conventions (part of the contract, repeated in SKILL.md):
 * - Pitch uses scientific notation: C4 = MIDI 60 (middle C). VOCALOID/Yamaha calls this C3;
 *   only the VOCALOID adapters convert.
 * - Time resolution is 480 ticks per quarter note (PPQ).
 * - A numeric position or duration is measured in quarter notes.
 * - A "bar:beat" position is 1-based; the beat unit is the time signature denominator.
 * - A fraction duration "a/b" is a fraction of a whole note: "1/4" = quarter, "3/8" = dotted quarter.
 */

export const PPQ = 480;

const NOTE_OFFSETS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export const PITCH_PATTERN = /^([A-Ga-g])(#{1,2}|b{1,2}|♯|♭)?(-?\d)$/;

export function parsePitch(input: string | number): number {
  if (typeof input === "number") {
    if (!Number.isInteger(input) || input < 0 || input > 127) {
      throw new RangeError(`MIDI note must be an integer 0-127, got ${input}`);
    }
    return input;
  }
  const match = PITCH_PATTERN.exec(input.trim());
  if (!match) throw new RangeError(`Invalid pitch "${input}" (expected e.g. C4, F#5, Bb3 or 0-127)`);
  const [, letter, accidental = "", octave] = match;
  let semis = NOTE_OFFSETS[letter!.toUpperCase()]!;
  for (const ch of accidental) semis += ch === "#" || ch === "♯" ? 1 : -1;
  const midi = (Number(octave) + 1) * 12 + semis;
  if (midi < 0 || midi > 127) throw new RangeError(`Pitch "${input}" is outside MIDI range`);
  return midi;
}

export function pitchName(midi: number): string {
  return `${SHARP_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

/** General MIDI percussion names accepted on drum tracks. */
export const DRUM_MAP: Record<string, number> = {
  kick: 36,
  kick2: 35,
  rim: 37,
  snare: 38,
  clap: 39,
  snare2: 40,
  "tom-low": 45,
  "tom-floor": 41,
  "tom-mid": 47,
  "tom-high": 50,
  "hihat-closed": 42,
  "hihat-pedal": 44,
  "hihat-open": 46,
  crash: 49,
  crash2: 57,
  ride: 51,
  "ride-bell": 53,
  china: 52,
  splash: 55,
  tambourine: 54,
  cowbell: 56,
  shaker: 82,
};

export function drumName(midi: number): string | undefined {
  return Object.entries(DRUM_MAP).find(([, n]) => n === midi)?.[0];
}

export function parseDrum(input: string | number): number {
  if (typeof input === "string" && input in DRUM_MAP) return DRUM_MAP[input]!;
  return parsePitch(input);
}

export function parseFraction(input: string): number {
  const match = /^(\d+(?:\.\d+)?)\/(\d+)$/.exec(input.trim());
  if (!match) throw new RangeError(`Invalid fraction "${input}" (expected e.g. 1/8)`);
  const value = Number(match[1]) / Number(match[2]);
  if (!(value > 0)) throw new RangeError(`Fraction "${input}" must be positive`);
  return value;
}

/** Duration in ticks. Number = quarter notes; "a/b" = fraction of a whole note. */
export function durationTicks(input: number | string): number {
  const ticks =
    typeof input === "number" ? input * PPQ : parseFraction(input) * 4 * PPQ;
  if (!(ticks > 0)) throw new RangeError(`Duration must be positive, got ${input}`);
  return Math.round(ticks);
}

export interface TimeSignature {
  bar: number; // 1-based bar where it starts
  numerator: number;
  denominator: number;
}

export interface BarInfo {
  bar: number;
  startTick: number;
  numerator: number;
  denominator: number;
  beatTicks: number;
  barTicks: number;
}

/** Maps bars to ticks under (possibly changing) time signatures. */
export class BarGrid {
  private readonly sigs: TimeSignature[];

  constructor(sigs: TimeSignature[]) {
    this.sigs = [...sigs].sort((a, b) => a.bar - b.bar);
    if (this.sigs[0]?.bar !== 1) this.sigs.unshift({ bar: 1, numerator: 4, denominator: 4 });
  }

  info(bar: number): BarInfo {
    let tick = 0;
    for (let i = 0; i < this.sigs.length; i++) {
      const sig = this.sigs[i]!;
      const next = this.sigs[i + 1];
      const beatTicks = (PPQ * 4) / sig.denominator;
      const barTicks = beatTicks * sig.numerator;
      if (!next || bar < next.bar) {
        return {
          bar,
          startTick: tick + (bar - sig.bar) * barTicks,
          numerator: sig.numerator,
          denominator: sig.denominator,
          beatTicks,
          barTicks,
        };
      }
      tick += (next.bar - sig.bar) * barTicks;
    }
    throw new Error("unreachable");
  }

  /** Inverse of position(): tick → "bar:beat" with up to 3 decimals. */
  label(tick: number): string {
    let bar = 1;
    while (this.info(bar + 1).startTick <= tick) bar++;
    const info = this.info(bar);
    const beat = 1 + (tick - info.startTick) / info.beatTicks;
    return `${bar}:${Number(beat.toFixed(3))}`;
  }

  get signatures(): readonly TimeSignature[] {
    return this.sigs;
  }
}

export const POSITION_PATTERN = /^(\d+):(\d+(?:\.\d+)?)$/;

/** Position in ticks. Number = quarter notes from song start; "bar:beat" is 1-based. */
export function positionTicks(input: number | string, grid: BarGrid): number {
  if (typeof input === "number") {
    if (input < 0) throw new RangeError(`Position must be >= 0, got ${input}`);
    return Math.round(input * PPQ);
  }
  const match = POSITION_PATTERN.exec(input.trim());
  if (!match) throw new RangeError(`Invalid position "${input}" (expected "bar:beat" like "5:2.5" or a number of quarter notes)`);
  const bar = Number(match[1]);
  const beat = Number(match[2]);
  if (bar < 1 || beat < 1) throw new RangeError(`Bar and beat are 1-based, got "${input}"`);
  const info = grid.info(bar);
  if (beat >= info.numerator + 1) {
    throw new RangeError(`Beat ${beat} does not exist in bar ${bar} (${info.numerator}/${info.denominator})`);
  }
  return Math.round(info.startTick + (beat - 1) * info.beatTicks);
}

export function parseTimeSignature(input: string): { numerator: number; denominator: number } {
  const match = /^(\d+)\/(1|2|4|8|16|32)$/.exec(input.trim());
  if (!match) throw new RangeError(`Invalid time signature "${input}" (expected e.g. 4/4, 6/8)`);
  return { numerator: Number(match[1]), denominator: Number(match[2]) };
}

export interface TempoPoint {
  tick: number;
  bpm: number;
}

/** Ticks → seconds under a tempo map. */
export function tickToSeconds(tick: number, tempos: TempoPoint[]): number {
  let seconds = 0;
  for (let i = 0; i < tempos.length; i++) {
    const t = tempos[i]!;
    const next = tempos[i + 1];
    const end = next && next.tick < tick ? next.tick : tick;
    if (end <= t.tick) break;
    seconds += ((end - t.tick) / PPQ) * (60 / t.bpm);
    if (!next || next.tick >= tick) break;
  }
  return seconds;
}
