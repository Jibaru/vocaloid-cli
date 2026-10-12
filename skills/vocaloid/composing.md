# Composing a vocaloid J-rock song

Reference for writing a full song in `song.yaml`. These are idioms, not rules. Sources are marked: *(sourced)* means checked against a chord site or an interview; *(listening)* means general listening knowledge.

## Form

Typical length is 2:40–3:30 *(listening)*:

```
intro hook (4–8 bars)
→ A verse (8)
→ B pre-chorus (8)
→ chorus (8–16)
→ A2, B2
→ chorus
→ bridge or half-time drop (8)
→ last chorus, often a key change up a half or whole step
→ outro hook
```

Put these in `sections:` so `song inspect` shows the form.

## Tempo and feel

- Fast: **160–210 BPM**, often felt in half-time in the verses *(sourced)*:
  - Ghost Rule ≈ 210
  - The Vampire ≈ 164
  - Rabbit Hole ≈ 173
  - Hibana ≈ 200
- Keys are often sharp keys: A, E, F#, C#m *(sourced, algorithmic estimates)*.

## Progressions

Roman numerals are in the major key.

| Progression | Chords | Where it shows up |
|---|---|---|
| **Royal road (王道進行)** | IV–V–iii–vi | The J-pop chorus staple. In A: D–E–C#m–F#m *(sourced)* |
| **Marunouchi** | IV–III7–vi–I | The Vampire's chorus. In E: A–G#7–C#m–E *(sourced)* |
| **Pop-punk loop** | vi–IV–V–I | Ghost Rule's chorus *(sourced)* |

- Spice with secondary dominants (III7 → vi) and a bVII–I lift into the chorus.

## Melody and vocal range

- **Range:** a bright female voice sits A3–E5. Keep verses mostly A3–C#5 and let choruses peak around D5–E5. Spend one high note per phrase, not every bar *(listening)*.
- **Rhythm:** verses use dense 16th-note syllables and repeated-note "rapid" lines. Choruses use longer notes and wider leaps (an octave jump into the hook) *(listening)*.
- **Hooks:** repeat a 2–4 note motif with a nonsense or chant syllable ("ra-ra-ra", "la-la") as a vocal hook *(listening)*.
- **Phrasing:** leave rests between phrases; a melody with no gaps sounds breathless.

## Arrangement

These are the instrument tracks and GM programs that match the style *(listening)*:

| Part | Programs | What to write |
|---|---|---|
| Drums | `drums` | Rock beat (kick on 1 and 3, snare on 2 and 4, 8th hats). Switch to four-on-the-floor in dance sections and half-time snare (beat 3 only) for drops. Add crash on section downbeats. |
| Bass | `electric_bass_pick` or `slap_bass_1` | Driving 8ths on the root, with octave jumps in choruses. |
| Guitars | `distortion_guitar` / `overdriven_guitar` | Power-chord rhythm (root + fifth + octave) in 8ths, plus a separate riff track doubling the vocal hook. Pan them L/R at about ±40. |
| Synths | `lead_2_sawtooth` (leads), `pad_3_polysynth`, `electric_piano_1` (plucks/stabs) | Leads and pads/stabs. |

- **Contrast:** drop most instruments for the last bar before a chorus (a "stop") so the chorus hits harder.

## Vocal tuning tips

- Use `voiceColor: Fragrance` on choruses and `Nectar` on soft bridges.
- Use vibrato only on long notes (≥ 1 beat): `vibrato: {depth: 30, period: 170, length: 50}`.
- Shape `curves.dynamics` up into the chorus (0 → 30) and down at phrase ends.
- A short `pitchBend` dip (−100 cents → 0) at the start of accented notes adds "attack".
