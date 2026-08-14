#!/usr/bin/env bash
# Smoke-tests a built container image, not the source tree.
#
#   ./scripts/docker-smoke.sh                    # tests loom:local
#   ./scripts/docker-smoke.sh ghcr.io/hspk/loom:latest
#
# Everything here is something the docs promise and the unit / Playwright
# suites cannot see, because they run against the repo rather than the
# image. The CLI checks exist because switching to Next's standalone output
# silently broke them: standalone's node_modules holds what the *server*
# entrypoints import, so `docker run … --version` died with
# ERR_MODULE_NOT_FOUND while the server itself stayed perfectly healthy.
# Deliberately not `set -e`: this is a test runner, so a failing check must
# be recorded and reported alongside the others rather than aborting the
# run at the first one. `fail` drives the exit code at the end.
set -uo pipefail

IMAGE="${1:-loom:local}"
NAME="loom-smoke-$$"
PORT="${PORT:-3399}"
VOLUME="loom-smoke-$$"

pass=0
fail=0

cleanup() {
    docker rm -f "$NAME" >/dev/null 2>&1 || true
    docker volume rm "$VOLUME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

check() {
    local label="$1" expected="$2" actual="$3"
    if printf '%s' "$actual" | grep -qF -- "$expected"; then
        printf '  ok    %s\n' "$label"
        pass=$((pass + 1))
    else
        printf '  FAIL  %s\n        expected to contain: %s\n        got: %s\n' \
            "$label" "$expected" "$(printf '%s' "$actual" | head -3 | tr '\n' ' ')"
        fail=$((fail + 1))
    fi
}

echo "==> image: $IMAGE"

echo "==> CLI passthrough"
# Matched strictly: the regression this guards against printed a Node
# stack trace whose last line was "Node.js v22.23.2", which any loose
# "did it output something" assertion would have waved through.
version_out=$(docker run --rm "$IMAGE" --version 2>&1 | tail -1)
case "$version_out" in
    [0-9]*.[0-9]*.[0-9]*) printf '  ok    --version prints a bare version (%s)\n' "$version_out"; pass=$((pass + 1)) ;;
    *) printf '  FAIL  --version printed: %s\n' "$version_out"; fail=$((fail + 1)) ;;
esac
check "--help lists subcommands" "start|dev|init|update" "$(docker run --rm "$IMAGE" --help 2>&1)"
check "init --print emits a config" "master_key" "$(docker run --rm "$IMAGE" init --print 2>&1)"

echo "==> MCP runtimes"
runtimes=$(docker run --rm --entrypoint sh "$IMAGE" -lc 'for b in node npx uvx uv python3 git; do command -v $b >/dev/null || echo "MISSING:$b"; done; echo RUNTIMES_OK')
check "runtime probe ran" "RUNTIMES_OK" "$runtimes"
missing=$(printf '%s' "$runtimes" | grep -o 'MISSING:[a-z0-9]*' | tr '\n' ' ' || true)
if [ -z "$missing" ]; then
    printf '  ok    node, npx, uvx, uv, python3 and git are all present\n'
    pass=$((pass + 1))
else
    printf '  FAIL  missing runtimes: %s\n' "$missing"
    fail=$((fail + 1))
fi

echo "==> cache volume ownership"
# A named volume is seeded from the image, so the mount point must already
# exist owned by node — otherwise it lands root-owned and every uvx server
# fails while npx ones keep working.
cache=$(docker run --rm -v "$VOLUME:/home/node/.cache" --entrypoint sh "$IMAGE" -lc 'touch /home/node/.cache/probe && echo CACHE_WRITABLE' 2>&1)
check "mounted cache volume is writable by node" "CACHE_WRITABLE" "$cache"
docker volume rm "$VOLUME" >/dev/null 2>&1 || true

echo "==> first boot"
docker run -d --name "$NAME" -p "127.0.0.1:$PORT:3000" -v "$VOLUME:/data" "$IMAGE" >/dev/null
for _ in $(seq 60); do
    curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && break
    sleep 1
done
check "health endpoint reports ok" '"status":"ok"' "$(curl -s "http://127.0.0.1:$PORT/api/health" 2>&1)"

logs=$(docker logs "$NAME" 2>&1)
check "first run prints admin credentials" "First-run admin credentials" "$logs"

# Read the credential from the generated config rather than scraping the
# banner. The generator uses base64url, so a `[A-Za-z0-9]+` match silently
# truncates at the first `-` or `_` — which passes locally whenever the
# random password happens to be alphanumeric and fails in CI when it isn't.
password=$(docker exec "$NAME" sh -lc "sed -n 's/^  password: \"\(.*\)\"$/\\1/p' /data/loom.config.yaml" 2>/dev/null | head -1)
login=$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:$PORT/api/login" \
    -H 'content-type: application/json' \
    -d "{\"user_name\":\"admin\",\"user_password\":\"$password\"}")
check "generated password logs in" "200" "$login"

echo
if [ "$fail" -gt 0 ]; then
    echo "$pass passed, $fail FAILED"
    exit 1
fi
echo "$pass passed"
