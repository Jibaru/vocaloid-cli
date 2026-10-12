import ToneMidi from "@tonejs/midi";
import { DRUMS } from "../catalog/instruments.ts";
import type { CompiledSong } from "../model/compile.ts";
import { PPQ } from "../model/music.ts";

const { Midi } = ToneMidi;

/**
 * Standard MIDI file. Vocal tracks are exported as melody lines (lyrics as MIDI lyric meta events
 * are not supported by @tonejs/midi, so lyrics go in the track name only); instrument tracks keep
 * their GM program, and drums go to channel 10.
 */
export function toMidi(song: CompiledSong, opts: { trackIds?: string[] } = {}): Uint8Array {
  const midi = new Midi();
  midi.header.tempos = song.tempos.map((t) => ({ ticks: t.tick, bpm: t.bpm }));
  // @tonejs/midi defaults to 480 PPQ, matching our resolution.
  if (midi.header.ppq !== PPQ) throw new Error(`Unexpected PPQ ${midi.header.ppq}`);
  midi.header.timeSignatures = song.timeSignatures.map((s) => ({
    ticks: song.grid.info(s.bar).startTick,
    timeSignature: [s.numerator, s.denominator],
    measures: s.bar - 1,
  }));
  midi.header.name = song.title;
  midi.header.update();

  let channel = 0;
  for (const track of song.tracks) {
    if (opts.trackIds && !opts.trackIds.includes(track.id)) continue;
    const t = midi.addTrack();
    t.name = track.name;
    if (track.kind === "vocal") {
      t.channel = nextChannel();
      t.instrument.number = 54; // voice_oohs, so a DAW preview sounds like a voice
      for (const n of track.notes) {
        t.addNote({ midi: n.midi, ticks: n.tick, durationTicks: n.dur, velocity: 0.8 });
      }
    } else {
      if (track.program === DRUMS) {
        t.channel = 9; // percussion is derived from channel 10
      } else {
        t.channel = nextChannel();
        t.instrument.number = track.program;
      }
      for (const n of track.notes) {
        t.addNote({ midi: n.midi, ticks: n.tick, durationTicks: n.dur, velocity: n.velocity / 127 });
      }
    }
  }
  return midi.toArray();

  function nextChannel(): number {
    const c = channel % 15;
    channel++;
    return c >= 9 ? c + 1 : c; // skip channel 10 (index 9), reserved for drums
  }
}
