#!/usr/bin/env bash
# Run vitest inside the pinned toolchain container.
#
# This repo's test suite needs Node (better-sqlite3 is a native addon that
# Bun cannot dlopen) plus a matching build toolchain. Use this wrapper when
# your host has no local Node/Bun:
#
#   scripts/vitest-docker.sh run --project node
#   scripts/vitest-docker.sh run --coverage
#   scripts/vitest-docker.sh bench
#
# With a local Node >= 20 just call `bun run test` / `npx vitest` directly.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${LOOM_TEST_IMAGE:-loom-dev}"

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
    echo "[loom:test] building $IMAGE ..."
    docker build -t "$IMAGE" -f - "$ROOT" >/dev/null <<'DOCKERFILE'
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates python3 make g++ git \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g bun@1.3.14
WORKDIR /app
DOCKERFILE
fi

exec docker run --rm \
    -u "$(id -u):$(id -g)" \
    -v "$ROOT:/app" \
    -e HOME=/tmp \
    -e CI=1 \
    "$IMAGE" \
    npx vitest "$@"
