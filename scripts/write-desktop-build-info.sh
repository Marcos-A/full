#!/bin/sh
# Write build-info.json into the desktop bundle, which has no server to provide one.
# Fails on uncommitted changes, unless ALLOW_DIRTY=1, because the commit wouldn't describe the build.
# release is null, unless RELEASE_TAG names the release this build is made for, such as v0.1.0.
set -eu
root="$(cd "$(dirname "$0")/.." && pwd)"
build_env=$("$root/scripts/build-env.sh")
eval "$build_env"
short=$(printf '%s' "$GIT_COMMIT" | cut -c1-7)
release=null
if [ -n "${RELEASE_TAG:-}" ]; then
  release=$(printf '{"version":"%s","tag":"%s","commit":"%s"}' "${RELEASE_TAG#v}" "$RELEASE_TAG" "$GIT_COMMIT")
fi
printf '{"schemaVersion":1,"app":"full","environment":"desktop","build":{"sha":"%s","shortSha":"%s","builtAt":"%s"},"release":%s}\n' \
  "$GIT_COMMIT" "$short" "$BUILD_TIME" "$release" > "$root/dist-desktop/build-info.json"
