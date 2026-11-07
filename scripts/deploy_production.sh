#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

export HOST_PORT="${HOST_PORT:-8098}"
export IMAGE_NAME="${IMAGE_NAME:-full-web:local}"
export CONTAINER_NAME="${CONTAINER_NAME:-full-web}"

# Identify the build by its commit; refuses uncommitted changes unless ALLOW_DIRTY=1.
set -a
eval "$("$repo_root/scripts/build-env.sh")"
set +a

mkdir -p build-meta
echo "Deploying $(git rev-parse --short HEAD) on port $HOST_PORT"
docker compose -f docker-compose.production.yml up -d --build

# Last, so that a failed deployment never advertises the new commit.
"$repo_root/scripts/write-build-info.sh" "$GIT_COMMIT" "$BUILD_TIME"

built_sha=$(docker inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$CONTAINER_NAME" 2>/dev/null || true)
if [ "$built_sha" != "$GIT_COMMIT" ]; then
  echo "WARNING: $CONTAINER_NAME reports commit '$built_sha', expected $GIT_COMMIT." >&2
fi

for _ in $(seq 1 15); do
  curl -fsS -o /dev/null "http://127.0.0.1:$HOST_PORT/" && { echo "Container is serving."; exit 0; }
  sleep 1
done
echo "ERROR: the container isn't answering on port $HOST_PORT." >&2
exit 1
