---
cli: vocaloid-cli
target: Singing-synthesis pipeline (OpenUtau/DiffSinger engine, FluidSynth, ffmpeg) plus VOCALOID/OpenUtau project formats
origin: mixed
built: 2026-10-12
status: internal
distribution: npm
---

# vocaloid-cli

## What it does

An agent writes a song as `song.yaml` (melody, lyrics, chords, sections, instrument parts). `vocaloid render` turns it into stems and a mastered mp3, with no GUI. The same model exports to VOCALOID (.vpr V5/V6, .vsqx V4), OpenUtau (.ustx) and MIDI, and imports .vpr/.vsqx/.ustx.

## Contract origin

**Mixed.**

- **Defined:** the song model (`src/model/song.ts`, Zod, schema v1) and the musical conventions: C4 = MIDI 60, `"bar:beat"` 1-based, numbers are quarter notes, `"a/b"` is a fraction of a whole note.
- **Discovered, without a full surface-recon:** subagents read open-source code, and every claim was checked against a run.
  - the VOCALOID formats (LibreSVIP, utaformatix3);
  - OpenUtau's `.ustx` and engine behaviour;
  - each voicebank's dictionary.

**The initial classification was right, but the target moved.** The user does not own VOCALOID, and no VOCALOID version has a headless render. "A CLI for VOCALOID" became "an audio pipeline with VOCALOID as an export target". That pivot came out of grilling round 2. It should have been asked in round 1: *do you own the tool you want wrapped?*

The defined side got three things wrong, all corrected by reading engine code or data:

- **`-` is silence, not a continuation:** `-` maps to SP in Hanami's dictionary.
- **`+` has a hidden condition:** it is a slur only when contiguous with the previous note (`UPart.cs:111`). That is now a compile error with a path.
- **Katakana changes vowels:** it selects different vowel phonemes on Hanami.

## Distribution choice

**npm, built to Node** (`bun build --target node`, `#!/usr/bin/env node`). The audience is agents on any machine with Node.

The heavy parts are fetched by `vocaloid setup` into `~/.vocaloid-cli` (`VOCALOID_CLI_HOME` overrides it):

- **Engine:** self-contained .NET binaries, built by `.github/workflows/engine.yml` from a pinned fork commit plus `engine/openutau-headless.patch`.
- **Voice:** 550 MB, downloaded from the author's original link because its terms forbid reuploads; sha256 verified.
- **Soundfont:** pinned to a commit, sha256 verified.

## Blocks adopted

cligentic was not installed, and installing a skill needs consent. **Hand-rolled equivalents:**

- `src/lib/style.ts`: detect/style; a single `shouldColor()`, 256-color semantic names, visible width counting CJK as 2.
- `src/lib/output.ts`: the envelope, `--fields` applied before the mode branch, and nextSteps.
- `src/lib/fsx.ts`: atomic write and rotating backups.
- `src/lib/progress.ts`: byte- and track-based progress, plus NDJSON with `--progress json`.

**Rejected for this domain:**

- **Trust ladder, audit log, killswitch:** the only possible damage is reversible local data loss, covered by `.history/` and `undo`.
- **Async `--wait` / job ledger:** a full render takes about 15 s, so synchronous with real progress and per-track caching is simpler.

## What broke

Everything below failed after it was believed done.

- **Engine errors.** The fork hid phonemizer errors behind a 60 s timeout, and a *partial* phonemization failure rendered successfully with a silent note. The patch now fails fast (exit 6, `{tick, lyric, error}`). The CLI maps ticks back to `tracks[i].notes[j].lyric`.
- **Upstream bug.** An OpenUtau G2P bug prefixed `en/` onto single-language voicebanks, so English never rendered. Patched; worth upstreaming.
- **`arrange` output size.** The first version wrote 7,600 generated notes into song.yaml (450 KB, unreadable for an agent, and stale on every chord edit). It was redesigned as declarative `generate: {part}`, expanded at compile time (5 KB). `--freeze` materializes notes for hand edits.
- **Lyrics.** `lyrics split` silently dropped kanji mixed with kana; it now refuses with LYRICS_UNPARSED. The syllable heuristic split "beautiful" into 4.
- **Engine build.** `engine/build.sh` failed with MSB3577 only from a fresh `mktemp -d`: macOS `/var` is a symlink to `/private/var`, and MSBuild resolves `DependentUpon` paths inconsistently under it. A wrong first guess about a build flag is recorded in friction.
- **Human output.** Read in a real pty, it showed defects every test missed:
  - a pitch range on drum tracks;
  - an all-dash lyric column (vertical repetition);
  - drum hits shown as pitch names;
  - a 5-level `../` path in nextSteps.
- **Dependency typings.** `tonal` 6.5.0's `types` points to a file it does not ship (worked around with tsconfig `paths`).

## What I would do differently

- **Ask about ownership first.** In grilling round 1, ask "do you own the tool you want wrapped, and does it run headless?" The pivot cost a round.
- **Treat a dependency's data files as contract.** Read the voicebank dictionary before writing lyric conventions into the skill. Two wrong claims (`-`, katakana) came from writing guidance before reading `dsdict-ja.yaml`.
- **Keep derived data out of the source of truth from the start.** `arrange` materializing notes was the obvious design and the wrong one for an agent-read file.

## Notes for cli-build

These are the inputs for correcting the skill.

- **Phase 0 lacks a feasibility branch.** "Discovered" assumes the target can be driven. Here the target (VOCALOID) cannot be driven headlessly at all, and the CLI's core became a different, open-source system. A feasibility check before recon would have caught it.
- **The dry-run rule needs a scale clause.** "Dry-run must exercise the real path" held, and `saveSongDoc(..., {dryRun})` runs the full compile. But the same edit-validation path also had to reject edits that leave the song invalid. "Validate the whole resulting state, not the delta" generalizes.
- **Convention candidate (1 build): derived data out of the source of truth.** When the agent's input file is also its working memory, generated content must not be materialized into it by default.
- **human-output.md held up.** "Vertical repetition is a heading" and "read it as someone who does not know the domain" both found real defects here.

## Evidence

- **Repo:** https://github.com/Jibaru/vocaloid-cli; package `@jibaru/vocaloid-cli` 0.1.0.
- **Tests:** 48 tests across 6 files (`bun test`), including agent-first rules run against `dist/cli.js` under plain `node` (`test/agent-first.test.ts`).
- **Cross-validation:** VOCALOID exports were parsed by LibreSVIP 2.9.2's converters with identical notes, ticks and tempos.
- **Running log:** `friction.md`. Plan and decisions: `docs/PLAN.md`.
