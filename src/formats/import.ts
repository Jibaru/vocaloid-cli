import { XMLParser } from "fast-xml-parser";
import { parse as parseYaml } from "yaml";
import { BarGrid, PPQ, type TimeSignature, pitchName } from "../model/music.ts";
import type { SongInput } from "../model/song.ts";
import { readVpr } from "./vpr.ts";

/**
 * Foreign project → song.yaml input. Only what our model can hold survives: tempo, time signatures,
 * vocal notes with lyrics. Controllers, vibrato and phoneme edits are dropped (reported as warnings).
 */

interface RawNote {
  tick: number;
  dur: number;
  midi: number;
  lyric: string;
}

interface RawTrack {
  name: string;
  language: "ja" | "en" | "es" | "ko" | "zh" | "de";
  notes: RawNote[];
}

interface RawProject {
  title: string;
  tempos: { tick: number; bpm: number }[];
  sigs: TimeSignature[];
  tracks: RawTrack[];
  warnings: string[];
}

const LANG_FROM_ID: Record<number, RawTrack["language"]> = { 0: "ja", 1: "en", 2: "ko", 3: "es", 4: "zh" };

const asArray = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

function fromVpr(bytes: Uint8Array, fallbackTitle: string): RawProject {
  const seq = readVpr(bytes);
  const warnings: string[] = [];
  const tracks: RawTrack[] = [];
  for (const t of seq.tracks ?? []) {
    if (t.type !== 0 && t.type !== 2) continue; // audio tracks
    const notes: RawNote[] = [];
    let langID = 0;
    for (const part of t.parts ?? []) {
      langID = part.voice?.langID ?? part.aiVoice?.langIDs?.[0]?.langID ?? langID;
      for (const n of part.notes ?? []) notes.push({ tick: part.pos + n.pos, dur: n.duration, midi: n.number, lyric: n.lyric });
    }
    if (notes.length) tracks.push({ name: t.name ?? `track ${tracks.length + 1}`, language: LANG_FROM_ID[langID] ?? "ja", notes });
  }
  if ((seq.tracks ?? []).some((t) => t.parts?.some((p) => (p as { controllers?: unknown[] }).controllers?.length))) {
    warnings.push("VOCALOID controller curves (dynamics, pitch bend, …) were not imported");
  }
  return {
    title: seq.title || fallbackTitle,
    tempos: (seq.masterTrack?.tempo?.events ?? [{ pos: 0, value: 12000 }]).map((e) => ({ tick: e.pos, bpm: e.value / 100 })),
    sigs: (seq.masterTrack?.timeSig?.events ?? [{ bar: 0, numer: 4, denom: 4 }]).map((e) => ({ bar: e.bar + 1, numerator: e.numer, denominator: e.denom })),
    tracks,
    warnings,
  };
}

function fromVsqx(text: string, fallbackTitle: string): RawProject {
  const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", cdataPropName: false, parseTagValue: true, trimValues: true });
  const doc = xml.parse(text) as Record<string, Record<string, unknown>>;
  const root = doc.vsq4 ?? doc.vsq3;
  if (!root) throw new Error("Not a .vsqx: no <vsq4> or <vsq3> root");
  const v4 = Boolean(doc.vsq4);
  // vsq3 uses long tag names, vsq4 short ones.
  const tag = v4
    ? { pos: "t", dur: "dur", num: "n", lyric: "y", part: "vsPart", sig: "timeSig", bar: "m", nu: "nu", de: "de", tempo: "tempo", bpm: "v" }
    : { pos: "posTick", dur: "durTick", num: "noteNum", lyric: "lyric", part: "musicalPart", sig: "timeSig", bar: "posMes", nu: "nume", de: "denomi", tempo: "tempo", bpm: "bpm" };
  const master = root.masterTrack as Record<string, unknown>;
  const pre = Number(master.preMeasure ?? 0);
  const sigsRaw = asArray(master[tag.sig] as Record<string, number> | Record<string, number>[]);
  const first = sigsRaw[0] ?? { [tag.nu]: 4, [tag.de]: 4 };
  const prefix = ((PPQ * 4) / Number(first[tag.de])) * Number(first[tag.nu]) * pre;
  const tempos = asArray(master[tag.tempo] as Record<string, number> | Record<string, number>[]).map((t) => ({
    tick: Math.max(0, Number(t[tag.pos]) - prefix),
    bpm: Number(t[tag.bpm]) / 100,
  }));
  const sigs = sigsRaw.map((s) => ({ bar: Math.max(1, Number(s[tag.bar]) - pre + 1), numerator: Number(s[tag.nu]), denominator: Number(s[tag.de]) }));
  const tracks: RawTrack[] = [];
  for (const vt of asArray(root.vsTrack as Record<string, unknown> | Record<string, unknown>[])) {
    const notes: RawNote[] = [];
    for (const part of asArray(vt[tag.part] as Record<string, unknown> | Record<string, unknown>[])) {
      const partPos = Number(part[tag.pos]) - prefix;
      for (const n of asArray(part.note as Record<string, unknown> | Record<string, unknown>[])) {
        notes.push({ tick: partPos + Number(n[tag.pos]), dur: Number(n[tag.dur]), midi: Number(n[tag.num]), lyric: String(n[tag.lyric] ?? "あ") });
      }
    }
    if (notes.length) tracks.push({ name: String(vt.name ?? vt.trackName ?? `track ${tracks.length + 1}`), language: "ja", notes });
  }
  return {
    title: String(master.seqName ?? fallbackTitle),
    tempos: tempos.length ? tempos : [{ tick: 0, bpm: 120 }],
    sigs: sigs.length ? sigs : [{ bar: 1, numerator: 4, denominator: 4 }],
    tracks,
    warnings: ["Track languages default to ja (.vsqx stores language on the voicebank); fix `language` if needed", "Controller curves were not imported"],
  };
}

function fromUstx(text: string, fallbackTitle: string): RawProject {
  const u = parseYaml(text) as {
    name?: string;
    bpm?: number;
    tempos?: { position: number; bpm: number }[];
    time_signatures?: { bar_position: number; beat_per_bar: number; beat_unit: number }[];
    tracks?: { track_name?: string }[];
    voice_parts?: { track_no: number; position: number; notes?: { position: number; duration: number; tone: number; lyric: string }[] }[];
  };
  const tracks: RawTrack[] = (u.tracks ?? []).map((t, i) => ({ name: t.track_name ?? `track ${i + 1}`, language: "ja", notes: [] }));
  for (const part of u.voice_parts ?? []) {
    const track = tracks[part.track_no];
    if (!track) continue;
    for (const n of part.notes ?? []) track.notes.push({ tick: part.position + n.position, dur: n.duration, midi: n.tone, lyric: n.lyric });
  }
  return {
    title: u.name || fallbackTitle,
    tempos: u.tempos?.length ? u.tempos.map((t) => ({ tick: t.position, bpm: t.bpm })) : [{ tick: 0, bpm: u.bpm ?? 120 }],
    sigs: u.time_signatures?.length
      ? u.time_signatures.map((s) => ({ bar: s.bar_position + 1, numerator: s.beat_per_bar, denominator: s.beat_unit }))
      : [{ bar: 1, numerator: 4, denominator: 4 }],
    tracks: tracks.filter((t) => t.notes.length > 0),
    warnings: ["Track languages default to ja; set `language` to match each track", "Curves, vibrato and phoneme overrides were not imported"],
  };
}

const slug = (s: string, i: number) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || `vocal-${i + 1}`;

/** Normalize to our rules: sorted, monophonic, "+" only when contiguous. */
function toSong(raw: RawProject, voice: string): { song: SongInput; warnings: string[] } {
  const warnings = [...raw.warnings];
  const grid = new BarGrid(raw.sigs);
  const ids = new Set<string>();
  const tracks = raw.tracks.map((t, i) => {
    let id = slug(t.name, i);
    while (ids.has(id)) id = `${id}-${i + 1}`;
    ids.add(id);
    const notes = [...t.notes].sort((a, b) => a.tick - b.tick);
    let trimmed = 0;
    for (let k = 1; k < notes.length; k++) {
      const prev = notes[k - 1]!;
      if (prev.tick + prev.dur > notes[k]!.tick) {
        prev.dur = Math.max(30, notes[k]!.tick - prev.tick);
        trimmed++;
      }
    }
    if (trimmed) warnings.push(`track "${id}": ${trimmed} overlapping note(s) were shortened (vocal tracks are monophonic)`);
    return {
      id,
      name: t.name,
      kind: "vocal" as const,
      voice,
      language: t.language,
      notes: notes.map((n, k) => {
        const prev = notes[k - 1];
        const contiguous = prev && prev.tick + prev.dur === n.tick;
        let lyric = n.lyric.trim() || "ら";
        if (lyric === "-" || lyric.startsWith("+")) lyric = contiguous ? "+" : t.language === "ja" ? "あ" : "ah";
        return { at: grid.label(n.tick), pitch: pitchName(n.midi), dur: Number((n.dur / PPQ).toFixed(3)), lyric };
      }),
    };
  });
  const song: SongInput = {
    schemaVersion: 1,
    title: raw.title,
    tempo: raw.tempos.length === 1 ? raw.tempos[0]!.bpm : raw.tempos.map((t) => ({ at: grid.label(t.tick), bpm: t.bpm })),
    timeSignature:
      raw.sigs.length === 1 ? `${raw.sigs[0]!.numerator}/${raw.sigs[0]!.denominator}` : raw.sigs.map((s) => ({ bar: s.bar, sig: `${s.numerator}/${s.denominator}` })),
    tracks,
  };
  return { song, warnings };
}

export type ImportFormat = "vpr" | "vsqx" | "ustx";

export function importProject(format: ImportFormat, bytes: Uint8Array, opts: { title: string; voice: string }) {
  const text = () => new TextDecoder().decode(bytes);
  const raw = format === "vpr" ? fromVpr(bytes, opts.title) : format === "vsqx" ? fromVsqx(text(), opts.title) : fromUstx(text(), opts.title);
  return toSong(raw, opts.voice);
}
