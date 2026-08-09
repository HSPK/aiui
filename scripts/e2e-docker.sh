#!/usr/bin/env bash
# Run the Playwright browser suite inside the pinned toolchain container.
#
#   scripts/e2e-docker.sh                    # everything
#   scripts/e2e-docker.sh --project=perf     # responsiveness benchmarks only
#   scripts/e2e-docker.sh --project=e2e      # functional smoke only
#
# The image pins Node 22 to match the better-sqlite3 ABI used by the unit
# suite and the production image; a Playwright base image on a different Node
# major cannot dlopen the native addon.
#
# Requires a production build (`bun run build`) — the suite deliberately
# measures `next start`, never `next dev`.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${LOOM_E2E_IMAGE:-loom-e2e}"

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
    echo "[loom:e2e] building $IMAGE ..."
    docker build -t "$IMAGE" -f - "$ROOT" >/dev/null <<'DOCKERFILE'
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates python3 make g++ git \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g bun@1.3.14
RUN npx --yes playwright@1.62.1 install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/*
ENV PLAYWRIGHT_BROWSERS_PATH=/root/.cache/ms-playwright
WORKDIR /app
DOCKERFILE
fi

if [ ! -d "$ROOT/.next" ]; then
    echo "[loom:e2e] no .next/ build found — run 'bun run build' first." >&2
    exit 1
fi

# Browsers live under /root in the image, so this runs as root; artifacts are
# chowned back afterwards.
docker run --rm \
    --ipc=host \
    -v "$ROOT:/app" \
    -e CI="${CI:-}" \
    -e HOME=/root \
    "$IMAGE" \
    sh -c "npx playwright test $* ; code=\$?; chown -R $(id -u):$(id -g) /app/e2e 2>/dev/null || true; exit \$code"
