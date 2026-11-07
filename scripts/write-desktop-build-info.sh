#!/bin/sh
# Write build-info.json into the desktop bundle, which has no server to provide one.
# Fails on uncommitted changes, unless ALLOW_DIRTY=1, because the commit wouldn't describe the build.
# release stays null until the app has a published release of its own.
set -eu
root="$(cd "$(dirname "$0")/.." && pwd)"
build_env=$("$root/scripts/build-env.sh")
eval "$build_env"
short=$(printf '%s' "$GIT_COMMIT" | cut -c1-7)
printf '{"schemaVersion":1,"app":"full","environment":"desktop","build":{"sha":"%s","shortSha":"%s","builtAt":"%s"},"release":null}\n' \
  "$GIT_COMMIT" "$short" "$BUILD_TIME" > "$root/dist-desktop/build-info.json"
