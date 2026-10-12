import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import type { VocaloidSinger } from "../catalog/singers.ts";
import type { CompiledSong, CompiledVocalTrack } from "../model/compile.ts";
import {
  LANG_ID,
  breathinessToVocaloid,
  centsToPit,
  dynamicsToVocaloid,
  pitchBendSensitivity,
  unsupportedCurves,
  vocaloidText,
} from "./vocaloid-common.ts";

/**
 * VOCALOID5/6 project (.vpr): a zip holding Project/sequence.json.
 * Structure verified against LibreSVIP (plugins/vpr/model.py, MIT) and utaformatix3's template.
 * VOCALOID6 opens files written as version 5.0.0. Ticks are 480 PPQ with no pre-measure.
 */

const SEQUENCE_PATH = "Project/sequence.json";

export interface VprOptions {
  singerFor: (track: CompiledVocalTrack) => VocaloidSinger;
}

export function toVprJson(song: CompiledSong, opts: VprOptions): { json: Record<string, unknown>; warnings: string[] } {
  const warnings: string[] = [];
  const vocals = song.tracks.filter((t): t is CompiledVocalTrack => t.kind === "vocal" && t.notes.length > 0);
  const singers = new Map<string, VocaloidSinger>();
  let fallbackPhonemes = 0;

  const tracks = vocals.map((track) => {
    const singer = opts.singerFor(track);
    singers.set(singer.compID, singer);
    const langID = LANG_ID[track.language];
    if (langID === undefined) warnings.push(`track "${track.id}": language ${track.language} has no VOCALOID langID; using Japanese`);
    const last = track.notes.at(-1)!;
    const notes = track.notes.map((n) => {
      const text = vocaloidText(track.language, n.lyric, n.phonemes);
      if (!text.derived) fallbackPhonemes++;
      return {
        lyric: text.lyric,
        phoneme: text.phoneme,
        isProtected: Boolean(n.phonemes),
        pos: n.tick,
        duration: n.dur,
        number: n.midi,
        velocity: 64,
        exp: { opening: 127 },
        singingSkill: { duration: 158, weight: { pre: 64, post: 64 } },
        vibrato: { type: 0, duration: 0 },
      };
    });
    const controllers: { name: string; events: { pos: number; value: number }[] }[] = [];
    if (track.curves.dynamics?.length) {
      controllers.push({ name: "dynamics", events: track.curves.dynamics.map((p) => ({ pos: p.tick, value: dynamicsToVocaloid(p.value) })) });
    }
    if (track.curves.breathiness?.length) {
      controllers.push({ name: "breathiness", events: track.curves.breathiness.map((p) => ({ pos: p.tick, value: breathinessToVocaloid(p.value) })) });
    }
    if (track.curves.pitchBend?.length) {
      const pbs = pitchBendSensitivity(track);
      controllers.push({ name: "pitchBendSens", events: [{ pos: 0, value: pbs }] });
      controllers.push({ name: "pitchBend", events: track.curves.pitchBend.map((p) => ({ pos: p.tick, value: centsToPit(p.value, pbs) })) });
    }
    const skipped = unsupportedCurves(track);
    if (skipped.length) warnings.push(`track "${track.id}": curves ${skipped.join(", ")} have no verified VOCALOID mapping and were not exported`);
    if (track.notes.some((n) => n.vibrato)) warnings.push(`track "${track.id}": per-note vibrato is not exported to .vpr yet (VOCALOID applies its default)`);

    const part: Record<string, unknown> = {
      pos: 0,
      duration: last.tick + last.dur,
      styleName: "No Effect",
      notes,
      ...(controllers.length ? { controllers } : {}),
    };
    if (singer.ai) part.aiVoice = { compID: singer.compID, langIDs: [{ langID: langID ?? 0 }] };
    else part.voice = { compID: singer.compID, langID: langID ?? 0 };
    return {
      type: singer.ai ? 2 : 0,
      name: track.name,
      color: 0,
      busNo: 0,
      isFolded: false,
      height: 0,
      // Volume/pan stay neutral: VOCALOID's units for these are unverified, and mixing is ours.
      volume: { isFolded: true, height: 40, events: [{ pos: 0, value: 0 }] },
      panpot: { isFolded: true, height: 40, events: [{ pos: 0, value: 0 }] },
      isMuted: track.mute,
      isSoloMode: false,
      parts: [part],
    };
  });

  if (fallbackPhonemes > 0) {
    warnings.push(
      `${fallbackPhonemes} note(s) got a placeholder phoneme; in VOCALOID select all notes and run Job → "Convert Phonemes to Match Language"`,
    );
  }
  const instrumentTracks = song.tracks.filter((t) => t.kind === "instrument").length;
  if (instrumentTracks > 0) {
    warnings.push(`${instrumentTracks} instrument track(s) are not part of .vpr; import build/stems/*.wav as audio tracks or use the MIDI export`);
  }

  const json = {
    version: { major: 5, minor: 0, revision: 0 },
    vender: "Yamaha Corporation",
    title: song.title,
    masterTrack: {
      samplingRate: 44100,
      loop: { isEnabled: false, begin: 0, end: song.endTick },
      tempo: {
        isFolded: false,
        height: 0,
        global: { isEnabled: false, value: Math.round((song.tempos[0]?.bpm ?? 120) * 100) },
        events: song.tempos.map((t) => ({ pos: t.tick, value: Math.round(t.bpm * 100) })),
      },
      timeSig: {
        isFolded: false,
        events: song.timeSignatures.map((s) => ({ bar: s.bar - 1, numer: s.numerator, denom: s.denominator })),
      },
      volume: { isFolded: false, height: 0, events: [{ pos: 0, value: 0 }] },
    },
    voices: [...singers.values()].map((s) => ({ compID: s.compID, name: s.name })),
    tracks,
  };
  return { json, warnings };
}

export function toVpr(song: CompiledSong, opts: VprOptions): { bytes: Uint8Array; warnings: string[] } {
  const { json, warnings } = toVprJson(song, opts);
  const bytes = zipSync({ [SEQUENCE_PATH]: strToU8(JSON.stringify(json)) }, { level: 6 });
  return { bytes, warnings };
}

export interface VprSequence {
  title?: string;
  masterTrack?: {
    tempo?: { events?: { pos: number; value: number }[] };
    timeSig?: { events?: { bar: number; numer: number; denom: number }[] };
  };
  voices?: { compID: string; name: string }[];
  tracks?: {
    type: number;
    name?: string;
    parts?: {
      pos: number;
      voice?: { compID: string; langID: number };
      aiVoice?: { compID: string; langIDs?: { langID: number }[] };
      notes?: { lyric: string; phoneme?: string; isProtected?: boolean; pos: number; duration: number; number: number }[];
    }[];
  }[];
}

export function readVpr(bytes: Uint8Array): VprSequence {
  const files = unzipSync(bytes);
  const entry = files["Project/sequence.json"] ?? files["Project\\sequence.json"];
  if (!entry) throw new Error("Not a .vpr: Project/sequence.json is missing");
  return JSON.parse(strFromU8(entry)) as VprSequence;
}
