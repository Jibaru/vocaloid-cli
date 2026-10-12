# Render engine

`vocaloid render` sings through a headless build of OpenUtau.

- **Source:** the community fork [boxboy523/OpenUtau-Headless](https://github.com/boxboy523/OpenUtau-Headless), MIT, which adds `OpenUtau.Cli`. It is pinned to a commit in `build.sh`.
- **Patch:** `openutau-headless.patch` holds our changes. Each one is worth upstreaming.
  - **DiffSinger G2P prefix fix.** Single-language voicebanks stopped getting an `en/` prefix on bare phonemes such as `aa`.
  - **Fail fast on phonemizer errors.** The engine exits 6 with `{tick, lyric, error}` instead of hitting a 60 s timeout. A partial failure no longer passes as a silent note.
  - **Opt-in logs.** Set `OPENUTAU_CLI_LOG=Error|Information` to send logs to stderr.

Build locally (needs the .NET 8 SDK):

```bash
engine/build.sh osx-arm64 /tmp/openutau-cli
vocaloid setup --engine-from /tmp/openutau-cli
```

CI (`.github/workflows/engine.yml`) builds osx-arm64 and linux-x64 on an `engine-v*` tag. It attaches `openutau-cli-<rid>.tar.gz` and its `.sha256` to the release, which `vocaloid setup` downloads.
