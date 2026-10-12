---
name: vocaloid
description: Compose and render VOCALOID-style songs with the `vocaloid` CLI. Use when asked to write, sing, arrange or render a song (vocaloid, J-pop/J-rock, DECO*27-like), to edit a song.yaml, or to export/import VOCALOID (.vpr, .vsqx), OpenUtau (.ustx) or MIDI projects.
---

# vocaloid

`vocaloid` turns a `song.yaml` (melody, lyrics, chords and instrument parts) into stems and a mixed `mix.mp3`. It sings with an open-source engine (OpenUtau + DiffSinger) and runs headless, so no GUI is needed. Every command returns JSON when piped, in the envelope `{ok, data, meta:{nextSteps, warnings}}` or `{ok:false, error:{code, message, hint, details:[{path, message}]}}`.

The live contract lives in the CLI, so treat these commands as the source of truth for flags and shapes:

- `vocaloid schema` lists every command with its flags and output shape.
- `vocaloid schema song` gives the JSON Schema for `song.yaml`.
- `vocaloid schema instruments` lists GM program names and drum names.

## Workflow

1. **Environment.** Run `vocaloid doctor`. If `healthy` is false, run each `nextSteps` command (usually `vocaloid setup`, which downloads about 600 MB once) and re-run `doctor`. Done when `healthy: true`.
2. **Scaffold.** Run `vocaloid init <dir> --style <id> [--key "F# minor"] [--tempo 180]`.
   - This writes the form (sections), one chord per bar, and an empty `lead` track.
   - `vocaloid style list` and `vocaloid style show <id>` describe the presets.
   - Without `--style` you get a 2-bar starter instead.
3. **Accompany.** Run `vocaloid arrange <dir>`. It adds drums, bass, guitars and keys that are *generated at render time* from `chords` and `sections`. To change the harmony or the form, edit those two lists and the parts follow; leave the generated tracks alone.
4. **Melody.** Write the lead with `vocaloid note add <dir> --track lead --params '[{"at":"33:1","pitch":"A4","dur":0.5,"lyric":"ら"},…]'`, one phrase per call.
   - Use `ら` as a placeholder lyric and stay inside the style's vocal range.
   - Read **Conventions** before writing notes.
5. **Lyrics.** Run `vocaloid lyrics split --text "…"` to count units per line, and shape each phrase to that count. Then run `vocaloid lyrics fit <dir> --track lead --from 33:1 --text "…"` to assign the line to the notes in order. Done when `lyrics fit` succeeds for every phrase.
6. **Validate.** Run `vocaloid song validate <dir>`. Errors arrive all at once, each with a path like `tracks[0].notes[12].pitch`. Fix every listed path, then re-run. Done when exit code is 0.
7. **Render.** Run `vocaloid render <dir>`. Done when `data.mix.mp3` exists.
   - Phonemization failures exit 6 and list the exact lyric paths; fix those lyrics and re-render.
   - Unchanged tracks come from cache, so iterating on one part is cheap (`--only <track>`).
8. **Review.** Run `vocaloid song inspect <dir>` and check the duration, the ranges per track and the lyric line. Report `data.mix.mp3` and `CREDITS.md` to the user.

## Conventions

These are the gotchas that `--help` does not confess.

- **Pitch** uses scientific notation: **C4 = MIDI 60 = middle C**. VOCALOID's editor calls this C3; ignore that.
- **Time** has two forms:
  - `at`: a number counts quarter notes from 0. `"bar:beat"` is 1-based (`"9:1"` is the downbeat of bar 9; `"9:2.5"` is the "and" of beat 2).
  - `dur`: a number counts quarter notes. `"a/b"` is a fraction of a whole note (`"1/8"` = eighth, `"3/8"` = dotted quarter).
- **Vocal tracks are monophonic.** Overlapping notes on one vocal track are an error. Harmonies go on their own vocal track.
- **Japanese lyrics:** one mora per note, in hiragana (`き`, `しゃ`, `ん`, `っ`) or romaji. Katakana selects different vowel phonemes on Hanami, so hiragana is the default. `vocaloid lyrics split` shows how a line divides.
- **English lyrics:** the whole word goes on its first note and each extra syllable's note gets `+` (`"beautiful"`, `"+"`, `"+"`). Splitting a word into syllable fragments mispronounces it.
- **Melisma (`+`):** in any language, a note whose lyric is `+` continues the previous note on a new pitch. It must start exactly where that note ends. `-` is a rest on Hanami; leave a gap instead.
- **Phoneme override:** `phonemes: "k a"` on a note forces pronunciation when the lyric is misread.
- **Voices:** run `vocaloid voice list`.
  - `hanami` is the default. It covers ja/en/es/ko/zh/de and allows commercial use with credit.
  - Voice colors (`voiceColor`) are `Root`, `Fragrance` (power, good for choruses) and `Nectar` (soft). Set them per track or per note.
- **Curves** (`curves.dynamics`, `pitchBend` (in cents), `breathiness`, `gender`, `tension`, `voicing`) take `[{at, value}]` points and are linearly interpolated. The range is -100..100 except `pitchBend` and `voicing`.
- **Instrument tracks** use a General MIDI program (`distortion_guitar`, `electric_bass_pick`, `lead_2_sawtooth`…) or `drums`. Drum notes use names: `kick`, `snare`, `hihat-closed`, `hihat-open`, `crash`, `ride`, `tom-high|mid|low|floor`, `clap`.
- **Mix:**
  - Each track has `volume` (dB), `pan` (-100..100) and `fx` (`auto` = vocal chain on vocals, none on instruments; also `vocal`, `room`, `none`).
  - The master is loudness-normalized to -14 LUFS (`--loudness`).
- **Arrangement:**
  - A track with `generate: {part: …}` gets notes from the style. Its explicit `notes` are added on top, which is useful for fills and riffs.
  - `vocaloid arrange --freeze --part bass --replace` writes the generated notes into `song.yaml` so you can hand-edit them. Frozen tracks stop following chord edits.
- **Licenses:** pass `render --commercial` when the user will publish for money. It fails if any voice forbids commercial use. Always hand over `CREDITS.md`.

## Editing safely

- **Validation:** every edit command validates the whole song before writing and refuses edits that would break it.
- **`--dry-run`:** add it to preview an edit without writing.
- **Undo:** `vocaloid undo <dir>` restores the previous version, from backups in `.history/`.
- **Note indices:** they come from `vocaloid note list` and are stable after `note edit`. After `note add`, notes are re-sorted by position, so re-list them before editing by index.
- **Generated notes:** `note list --generated` includes them, with `index: null`. Generated notes cannot be edited by index.
- **Reading song.yaml:** read it with `song inspect` and `note list --track <id> --from … --to …` rather than whole: it grows with every note.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | ok |
| 2 | usage / bad argument |
| 3 | `song.yaml` invalid (`details` has paths) |
| 4 | missing dependency (`hint` has the install command) |
| 5 | render failure |
| 6 | lyrics the voice cannot pronounce |

## VOCALOID export and import

To hand the song to a real VOCALOID editor (Miku V6, V5, V4), to choose a VOCALOID singer, or to import a `.vpr`/`.vsqx`/`.ustx`, read [vocaloid-export.md](vocaloid-export.md).

## Composing

For song form, J-rock/vocaloid arrangement and DECO*27-style idioms (tempo, progressions, density, vocal range), read [composing.md](composing.md) before writing a full song.
