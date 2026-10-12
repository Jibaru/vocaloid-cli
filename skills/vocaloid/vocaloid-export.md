# Exporting to VOCALOID

Read this when the user owns VOCALOID (or a trial) and wants the real Hatsune Miku or another VOCALOID voicebank instead of the built-in open-source render.

## Pick the format by editor version

| User's editor | Format | Command |
|---|---|---|
| VOCALOID6 (incl. Miku V6, VOCALOID:AI voices) | `.vpr` | `vocaloid song export <dir> --format vpr --singer <id>` |
| VOCALOID5 | `.vpr` | same |
| VOCALOID4 | `.vsqx` (vsq4) | `vocaloid song export <dir> --format vsqx --singer <id>` |
| VOCALOID3 | not supported for writing; ask the user to open the `.vsqx` in V4+ or use MIDI | — |
| Piapro Studio NT/NT2 (Miku NT) | `.mid` | `vocaloid song export <dir> --format mid` (then type lyrics in the editor) |
| OpenUtau | `.ustx` | `vocaloid song export <dir> --format ustx` |

VOCALOID6 also opens `.vsqx`, but `.vpr` keeps AI tracks.

## Singers (compID)

- **How the editor identifies a singer:** by a compID, a 16-character ID. There is no public list.
  - Only `vy2v3` ships built in.
  - Without `--singer` the export uses it and warns.
- **Get the user's real singers:**
  - Easiest: ask the user to save any empty project with their voicebank in their editor, then run `vocaloid singer import <that file.vpr|.vsqx>`.
  - Or, if the user knows a compID: `vocaloid singer add --comp-id <ID> --name "<name>" [--ai]`.
- **Choose singers per track:** `--singer lead=miku-v6,harmony=vy2v3`.
- **AI voices:** singers marked `ai` (VOCALOID:AI, e.g. Miku V6) are written as AI tracks in `.vpr`. `.vsqx` cannot carry them.

## What carries over

| Element | `.vpr` / `.vsqx` behavior |
|---|---|
| Notes, lyrics, tempo map, time signatures | Exported as-is |
| Japanese phonemes | Converted to VOCALOID symbols (き → `k' i`) |
| `+` continuation notes | Become VOCALOID's legato `-` |
| `phonemes:` overrides | Written and locked |
| Non-Japanese phonemes | Get a placeholder. Tell the user to select all notes and run **Job → Convert Phonemes to Match Language** |
| `dynamics`, `breathiness`, `pitchBend` curves | Exported |
| `gender`, `tension`, `voicing`, per-note vibrato | Not exported (the command warns) |
| Instrument tracks | Not inside the project. Hand over `build/stems/*.wav` (import as audio tracks) or `build/song.mid` |
| Track volume/pan | Left neutral; mixing happens in the editor |

## Importing

`vocaloid song import <file.vpr|.vsqx|.ustx> --out <dir>` turns an existing project into a `song.yaml`:

- **Kept:** notes and lyrics.
- **Dropped:** curves.
- **Languages:** they default from the file; check `language` on each track before rendering.
