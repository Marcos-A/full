#!/bin/sh
# Write build-meta/build-info.json from the release info and the running image's commit.
# Run by the deploy script, and again after publishing a release: no rebuild is needed.
#   write-build-info.sh <commit-sha> [built-at]
set -eu
sha=${1:?usage: write-build-info.sh <commit-sha> [built-at]}
built_at=${2:-}
root="$(cd "$(dirname "$0")/.." && pwd)"
out="$root/build-meta/build-info.json"
environment=${APP_ENV:-production}
"$root/scripts/update-release-info.sh" "$root/build-meta/release-info.json" "$sha"
release=$(cat "$root/build-meta/release-info.json")
built=""
[ -n "$built_at" ] && built=",\"builtAt\":\"$built_at\""
short=$(printf '%s' "$sha" | cut -c1-7)
tmp="$out.tmp"
printf '{"schemaVersion":1,"app":"full","environment":"%s","build":{"sha":"%s","shortSha":"%s"%s},"release":%s}\n' \
  "$environment" "$sha" "$short" "$built" "$release" > "$tmp"
chmod 644 "$tmp"
mv "$tmp" "$out"
