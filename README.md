# vocaloid-cli

Compose VOCALOID-style songs as a `song.yaml` and render them to finished audio, headlessly. The CLI is built for AI agents (JSON when piped, a versioned `schema`, structured errors with fixes) and stays readable for humans.

```bash
npm i -g @jibaru/vocaloid-cli
vocaloid setup                      # engine, ffmpeg/fluidsynth check, soundfont, default voice (~600 MB once)
vocaloid init my-song --style jrock-vocaloid --key "F# minor"
vocaloid arrange my-song            # drums, bass, guitars, synth from the chords + form
vocaloid note add my-song --track lead --params '[{"at":"33:1","pitch":"A4","dur":0.5,"lyric":"ら"}]'
vocaloid lyrics fit my-song --track lead --from 33:1 --text "きみのこえがきこえたら"
vocaloid render my-song             # build/stems/*.wav, build/mix.wav, build/mix.mp3, CREDITS.md
```

## What it does

| Area | What you get |
|---|---|
| **Sing** | Rendered with [OpenUtau](https://github.com/stakira/OpenUtau) + DiffSinger through a headless engine build. The default voice is Hoshino Hanami (ja/en/es/ko/zh/de; commercial use allowed, credit required). |
| **Accompany** | Style presets (`jrock-vocaloid`, `idol-pop`, `ballad`) generate drums, bass, guitars and keys from `chords` + `sections`, rendered by FluidSynth with GeneralUser GS. |
| **Mix** | Per-track volume, pan and effects (ffmpeg), loudness-normalized master (-14 LUFS), with stems cached per track. |
| **Export** | `.vpr` (VOCALOID5/6, including AI tracks), `.vsqx` (VOCALOID4), `.ustx` (OpenUtau) and `.mid`. To get the real Hatsune Miku, export and open the result in VOCALOID6 or Piapro Studio. |
| **Import** | `.vpr`, `.vsqx` (v3/v4) and `.ustx` → `song.yaml`. |

## For agents

- `vocaloid schema` lists every command with its flags and output shape. `vocaloid schema song` gives the JSON Schema for `song.yaml`.
- `vocaloid skill install [--agent claude|codex|agents]` installs the agent manual matching the installed CLI version, and `vocaloid skill status` reports drift.
- Every command answers in the envelope `{ok, data, meta:{nextSteps, warnings}}`. Failures answer `{ok:false, error:{code, message, hint, details:[{path, message}]}}`.
- Exit codes:

| Code | Meaning |
|---|---|
| 0 | Success |
| 2 | Usage error |
| 3 | Invalid song |
| 4 | Missing dependency |
| 5 | Render failure |
| 6 | Unpronounceable lyric |

## Conventions

- **Pitch:** C4 = MIDI 60 (middle C).
- **Positions:** `"bar:beat"` (1-based) or a number of quarter notes.
- **Durations:** a number of quarter notes, or a fraction of a whole note (`"1/8"`).
- **Lyrics:** Japanese is one mora per note; English puts the word on its first note and `+` on each extra syllable.

## Requirements

- Node 20+ and ffmpeg.
- fluidsynth for instrument tracks; `vocaloid setup --install-deps` installs it with Homebrew.
- A prebuilt engine for macOS arm64 and Linux x64. On other platforms, build `OpenUtau.Cli` from the fork and run `vocaloid setup --engine-from <dir>`.

## Licenses

MIT. Voices and soundfonts are downloaded from their original sources under their own terms; `vocaloid voice show <id>` prints them and every render writes `CREDITS.md`. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
