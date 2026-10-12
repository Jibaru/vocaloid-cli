#!/usr/bin/env bash
# Build the headless OpenUtau engine used by `vocaloid render`.
# Usage: engine/build.sh <rid> <out-dir>     (rid: osx-arm64 | linux-x64)
set -euo pipefail

UPSTREAM="https://github.com/boxboy523/OpenUtau-Headless.git"
# Pinned: our patch is written against this commit.
COMMIT="db6ddc728463197495ef39ef95886ccdf9970ddf"

RID="${1:?runtime id, e.g. osx-arm64}"
OUT="${2:?output directory}"
HERE="$(cd "$(dirname "$0")" && pwd)"
# Canonical path: on macOS mktemp returns /var/... (a symlink to /private/var/...), and MSBuild then
# resolves DependentUpon paths inconsistently, failing with MSB3577 on the three Resources.resx files.
WORK="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$WORK"' EXIT

git clone --quiet "$UPSTREAM" "$WORK/src"
git -C "$WORK/src" checkout --quiet "$COMMIT"
git -C "$WORK/src" apply --ignore-whitespace "$HERE/openutau-headless.patch"

export DOTNET_CLI_TELEMETRY_OPTOUT=1
OUT_ABS="$(mkdir -p "$OUT" && cd "$OUT" && pwd -P)"
cd "$WORK/src"
dotnet publish OpenUtau.Cli -c Release -r "$RID" --self-contained true -o "$OUT_ABS" | grep -E " error |OpenUtau.Cli ->" || true
test -x "$OUT_ABS/OpenUtau.Cli"
echo "built $OUT_ABS/OpenUtau.Cli for $RID"
