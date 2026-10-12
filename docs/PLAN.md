# vocaloid-cli plan

Package `@jibaru/vocaloid-cli`, binary `vocaloid`. An agent-first CLI that lets an AI agent
compose a complete VOCALOID-style song (J-pop / J-rock, e.g. DECO*27-like) and export finished
audio headlessly, plus export real VOCALOID projects (.vpr / .vsqx) for use with licensed voices.

Built following the `cli-build` skill. Decisions were settled in a grilling session (Q1–Q26).

## Contract origin (cli-build Phase 0)

**Mixed.**

- **Defined:** the canonical song model in `song.yaml`. It is versioned and validated with Zod.
- **Discovered:** the VOCALOID formats (.vpr V5/V6, .vsqx V3/V4, .vsq V2), the OpenUtau `.ustx`
  format, and the behaviour of the OpenUtau render engine.

## Architecture

```
song.yaml ──► canonical model ──┬─► formats: ustx, mid, musicxml, vpr (V5/V6 classic + AI), vsqx (V3/V4)
                                └─► engines: openutau (DiffSinger/UTAU, default), neutrino (JA, optional)
instrument tracks (MIDI) ──► fluidsynth + free soundfonts ──► stems
vocal stem + instrument stems ──► ffmpeg (EQ, compression, reverb via IR, loudnorm) ──► mix.wav / mix.mp3
```

- **Pitch:** scientific notation everywhere, so C4 = MIDI 60. Adapters convert to Yamaha's
  convention, where C3 = 60.
- **Time:** bars and beats, or beats. Internally 480 PPQ.
- **Song directory:**
  - `song.yaml` is the source of truth.
  - `build/` holds generated files.
  - `CREDITS.md` is generated from the voices and soundfonts used.
  - `.history/` holds rotating backups for `undo`.
- **Render:** synchronous, with real progress on stderr (`--progress json` emits NDJSON
  events). Results are cached per track using a content hash.
- **Dependencies:** no Python. The runtime needs ffmpeg, fluidsynth, and the engine binary.
  `vocaloid setup` installs them and `vocaloid doctor` verifies them.

## Voices

- **Curated catalog.** Each entry records its license, languages, and download URL.
- **Default voice:** Hoshino Hanami ~AI❤dol~ (DiffSinger). Commercial use is allowed, and it
  sings in 8 languages.
- **Kasane Teto (UTAU):** first-class option, non-commercial only.
- **`--commercial`:** fails with a structured error when a voice's license forbids commercial use.
- **No Miku clone models.** The real Miku goes through `.vpr` export to VOCALOID6 (Miku V6) or
  Piapro NT.

## Command surface

```
vocaloid init <dir> [--style jrock-vocaloid]
vocaloid render [dir]                         # shorthand: song.yaml → stems + mix
vocaloid song validate|inspect|export|import
vocaloid track add|list|remove
vocaloid note add|edit|delete|list            # --dry-run returns the diff
vocaloid param set|list
vocaloid lyrics fit                           # JA morae / EN syllables → notes
vocaloid arrange --part drums|bass|guitar     # accompaniment from chords + style preset
vocaloid style list|show
vocaloid voice list|install|add|show
vocaloid singer list|add                      # VOCALOID compIDs for export
vocaloid setup | doctor
vocaloid skill install [--agent claude|codex]
vocaloid schema [command|song]
vocaloid undo
```

Every command follows the same contract:

- **Output:** JSON when stdout is not a TTY or when `--json` is passed.
- **Envelope:** `{ok, data, meta: {nextSteps}}` on success, and
  `{ok:false, error:{code,message,hint}}` on failure.
- **Exit codes:** they mean something; user error and system failure are distinguishable.
- **Diagnostics:** stderr only.
- **Human surface:** a TTY-only banner.

## Safety (Phase 4)

Low risk: the only possible damage is reversible local data loss. The safeguards are:

- atomic writes;
- `.history/` backups with `undo`;
- `--dry-run` on edits;
- download sizes shown before `setup` and `voice install`.

No audit log and no trust ladder.

## Distribution

- **Language and build:** TypeScript with Bun as the toolchain, built to Node with a
  `#!/usr/bin/env node` shebang, and published to npm.
- **Engine fork:** `Jibaru/openutau-headless`, MIT, with a pinned upstream commit. CI publishes
  self-contained binaries for osx-arm64 and linux-x64 to GitHub Releases.
- **Agent manual:** `skills/vocaloid/SKILL.md` ships in the repo, and
  `vocaloid skill install` writes the version-matched skill.

## Phases

1. **Spike: done.** Headless OpenUtau + Hanami renders JA/EN on macOS arm64.
2. **Core: done.** The song.yaml schema; init, validate, inspect and schema; editing commands with
   `--dry-run` and undo; ustx and mid export; vocal render through the engine.
3. **Instrumental: done.**
   - FluidSynth with GeneralUser GS for instrument stems.
   - ffmpeg for the per-track fx chains and a mix normalized to -14 LUFS.
   - Stems cached per track.
4. **Composition helpers: done.**
   - Style presets: `jrock-vocaloid`, `idol-pop`, `ballad`.
   - `arrange`, which is declarative (`generate:`) with `--freeze`.
   - `lyrics split` and `lyrics fit`.
5. **VOCALOID formats: done.**
   - Export: `.vpr` (V5/V6, classic and AI tracks) and `.vsqx` (V4), cross-checked with LibreSVIP's
     parser.
   - Import: `.vpr`, `.vsqx` (v3/v4) and `.ustx`.
   - The `singer` catalog: `import` reads compIDs from the user's own project files.
6. **Release: partly done.**
   - Done: `skill install` and `skill status` (version-stamped), the doctor skill check, the
     README/LICENSE/notices, the engine build script, and the CI workflows (ci + engine release).
   - Pending, needs the user's go-ahead: creating the GitHub repo, the first push, tagging
     `engine-v0.1.0`, and `npm publish`.

**Change from the original plan:** engine binaries are built by this repo's `engine` workflow
(`engine/build.sh` with the pinned fork commit and our patch) instead of a separate
`openutau-headless` repo. There is one repo to maintain, and `vocaloid setup` downloads from
`Jibaru/vocaloid-cli` releases tagged `engine-v*`.

## Reference sources

- **LibreSVIP** (MIT) has the most complete vpr/vsqx models, including V6 AI fields:
  `libresvip/plugins/vpr/model.py` and `plugins/vsqx`.
- **utaformatix3** (Apache-2.0) has vsq/vsqx/vpr templates.
- **OpenUtau-Headless** (boxboy523, MIT) is the base of our engine fork.
- **The VOCALOID6 Reference Manual** lists the parameters on p.50–51 and the phoneme tables
  on p.77–89.
