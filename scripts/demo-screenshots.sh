#!/usr/bin/env bash
# Regenerates the screenshots in docs/assets.
#
# Spins up a throwaway Loom on its own volume and port, points it at a
# scripted OpenAI-compatible upstream, drives real traffic through the
# real gateway, gives the resulting logs a believable shape, and captures
# every page. Nothing here touches a development or production install.
#
#   ./scripts/demo-screenshots.sh
#   THEMES=light ./scripts/demo-screenshots.sh     # single theme
#
# Requires the `loom:local` image (docker build -t loom:local .) and the
# `loom-e2e` image built by scripts/e2e-docker.sh.
set -euo pipefail

cd "$(dirname "$0")/.."

PORT="${PORT:-3100}"
UPSTREAM_PORT="${UPSTREAM_PORT:-8099}"
OUT="${OUT:-docs/assets}"
THEMES="${THEMES:-light,dark}"
IMAGE="${IMAGE:-loom:local}"
PASSWORD="demo-admin-pw"

cleanup() {
    docker rm -f loom-demo loom-demo-upstream >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup
docker volume rm loom-demo-data >/dev/null 2>&1 || true

CONFIG="$(mktemp)"
cat > "$CONFIG" <<EOF
master_key: "demo-master-key-for-screenshots-only-0001"
server:
  hostname: 0.0.0.0
  port: 3000
admin:
  username: admin
  password: ${PASSWORD}
EOF
chmod 644 "$CONFIG"

echo "==> scripted upstream on :${UPSTREAM_PORT}"
docker run -d --name loom-demo-upstream --network=host \
    -v "$PWD/scripts:/s:ro" -w /s \
    node:22-slim node demo-upstream.mjs "$UPSTREAM_PORT" >/dev/null

echo "==> loom on :${PORT}"
docker run -d --name loom-demo \
    -p "127.0.0.1:${PORT}:3000" \
    --add-host=demo-upstream:host-gateway \
    -v loom-demo-data:/data \
    -v loom-demo-cache:/home/node/.cache \
    -v "$CONFIG:/app/loom.config.yaml:ro" \
    -e LOOM_SERVER_HOSTNAME=0.0.0.0 \
    "$IMAGE" >/dev/null

for _ in $(seq 60); do
    curl -sf "http://127.0.0.1:${PORT}/api/health" >/dev/null && break
    sleep 1
done

# The git MCP server needs a real repository to open, and /data is just a
# volume. Give it one so the health column isn't a red herring.
docker exec -u node loom-demo sh -lc '
    mkdir -p /data/repo && cd /data/repo && [ -d .git ] || {
        git init -q .
        git config user.email demo@loom.local && git config user.name "Loom demo"
        printf "# Demo repository\n\nBacks the git MCP server in the screenshots.\n" > README.md
        git add README.md && git commit -qm "Initial commit"
    }' >/dev/null

echo "==> seeding"
docker run --rm --network=host -v "$PWD/scripts:/s:ro" -w /s \
    node:22-slim node demo-seed.mjs "http://127.0.0.1:${PORT}"

echo "==> shaping traffic history"
docker cp scripts/demo-humanise.mjs loom-demo:/app/demo-humanise.mjs
docker exec -w /app loom-demo node demo-humanise.mjs /data/loom.db

echo "==> capturing"
mkdir -p "$OUT"
docker run --rm --network=host -v "$PWD:/app" -w /app \
    -e HOME=/root -e THEMES="$THEMES" \
    -e PLAYWRIGHT_BROWSERS_PATH=/root/.cache/ms-playwright \
    loom-e2e node scripts/demo-shots.mjs "http://127.0.0.1:${PORT}" "$OUT"

# Lossless recompression — these are 2x-DPI PNGs that ship in the README,
# so a third off the byte count is worth the few seconds.
docker run --rm -v "$PWD/$OUT:/a" -w /a alpine \
    sh -c 'apk add -q --no-cache optipng && optipng -quiet -o2 -strip all *.png'

docker run --rm -v "$PWD:/app" -w /app alpine \
    chown -R "$(id -u):$(id -g)" "$OUT"

rm -f "$CONFIG"
echo "==> done: $(ls "$OUT" | wc -l) images in $OUT"
