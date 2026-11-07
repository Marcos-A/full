#!/bin/sh
# Run a command in the Playwright image, so that neither Node nor browsers are
# needed on the host. Usage: scripts/in-docker.sh npm test
set -eu
root="$(cd "$(dirname "$0")/.." && pwd)"
image="mcr.microsoft.com/playwright:v1.65.0-noble"
exec docker run --rm --init --ipc=host -u "$(id -u):$(id -g)" \
  -e HOME=/tmp/home -e npm_config_cache=/tmp/npm-cache -e CI="${CI:-}" \
  -e BASE_URL="${BASE_URL:-}" \
  -v "$root:/work" -w /work "$image" "$@"
