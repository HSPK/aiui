#!/bin/sh
# ---------------------------------------------------------------------------
# Loom container entrypoint.
#
# Makes `docker run -p 3000:3000 -v loom-data:/data ghcr.io/hspk/loom` work
# with zero configuration by bootstrapping a config file on the data volume
# the first time the container starts. Everything it generates is persisted
# to /data, so restarts and upgrades keep the same master key (and therefore
# keep stored provider secrets readable).
#
# Precedence, highest first:
#   1. LOOM_* environment variables (never overridden — see lib/preflight.ts)
#   2. An explicit $LOOM_CONFIG_PATH
#   3. A config file mounted into the CLI search order (/app, /app/.config,
#      $HOME/.config)
#   4. /data/loom.config.yaml (auto-generated on first boot)
# ---------------------------------------------------------------------------

set -eu

APP_DIR=/app
DATA_DIR="${LOOM_DATA_DIR:-/data}"
BOOTSTRAP_CONFIG="${DATA_DIR}/loom.config.yaml"

log()  { printf '[loom:docker] %s\n' "$*"; }
warn() { printf '[loom:docker] %s\n' "$*" >&2; }

rand() { node -e "process.stdout.write(require('node:crypto').randomBytes($1).toString('base64url'))"; }

# A config file already visible to lib/preflight.ts's search order?
mounted_config() {
    for f in \
        "${APP_DIR}/loom.config.yaml" "${APP_DIR}/loom.config.yml" "${APP_DIR}/loom.config.json" \
        "${APP_DIR}/.config/loom.yaml" "${APP_DIR}/.config/loom.yml" "${APP_DIR}/.config/loom.json" \
        "${HOME:-/home/node}/.config/loom.yaml" "${HOME:-/home/node}/.config/loom.yml" "${HOME:-/home/node}/.config/loom.json"
    do
        [ -f "$f" ] && { printf '%s' "$f"; return 0; }
    done
    return 1
}

write_bootstrap_config() {
    if ! mkdir -p "$DATA_DIR" 2>/dev/null || [ ! -w "$DATA_DIR" ]; then
        warn "${DATA_DIR} is not writable by uid $(id -u)."
        warn "Use a named volume, or chown the host directory:  sudo chown -R 1000:1000 <hostdir>"
        exit 1
    fi

    master_key="${LOOM_MASTER_KEY:-$(rand 32)}"
    admin_user="${LOOM_ADMIN_USERNAME:-admin}"
    admin_pass="${LOOM_ADMIN_PASSWORD:-}"
    generated_pass=0
    if [ -z "$admin_pass" ]; then
        admin_pass=$(rand 12)
        generated_pass=1
    fi

    umask 077
    cat > "$BOOTSTRAP_CONFIG" <<CONFIG
# Loom configuration — generated on first container start.
#
# KEEP THIS FILE SECRET: master_key decrypts every stored provider and MCP
# credential. Rotating it makes existing encrypted secrets unreadable.
#
# Environment variables always win over this file, so you can override any
# value from your orchestrator without editing it.

master_key: "${master_key}"

# Created on first boot, only while the users table is empty.
admin:
  username: "${admin_user}"
  password: "${admin_pass}"
CONFIG
    chmod 600 "$BOOTSTRAP_CONFIG" 2>/dev/null || true

    log "generated ${BOOTSTRAP_CONFIG}"
    if [ "$generated_pass" -eq 1 ]; then
        printf '\n'
        printf '  ┌────────────────────────────────────────────────────────┐\n'
        printf '  │  First-run admin credentials (shown once)               \n'
        printf '  │                                                         \n'
        printf '  │    username : %s\n' "$admin_user"
        printf '  │    password : %s\n' "$admin_pass"
        printf '  │                                                         \n'
        printf '  │  Also stored in %s\n' "$BOOTSTRAP_CONFIG"
        printf '  │  Set LOOM_ADMIN_PASSWORD to choose your own.            \n'
        printf '  └────────────────────────────────────────────────────────┘\n\n'
    fi
}

prepare_config() {
    if [ -n "${LOOM_CONFIG_PATH:-}" ]; then
        [ -f "$LOOM_CONFIG_PATH" ] || warn "LOOM_CONFIG_PATH=${LOOM_CONFIG_PATH} does not exist — falling back to environment variables only."
        return 0
    fi
    if found=$(mounted_config); then
        log "using mounted config ${found}"
        return 0
    fi
    if [ -f "$BOOTSTRAP_CONFIG" ]; then
        LOOM_CONFIG_PATH="$BOOTSTRAP_CONFIG"
        export LOOM_CONFIG_PATH
        return 0
    fi
    if [ -n "${LOOM_MASTER_KEY:-}" ] && [ -n "${LOOM_ADMIN_PASSWORD:-}" ]; then
        log "configured entirely from environment variables"
        return 0
    fi
    write_bootstrap_config
    LOOM_CONFIG_PATH="$BOOTSTRAP_CONFIG"
    export LOOM_CONFIG_PATH
}

# Informational flags are CLI invocations, not server flags — check before
# the bare-flag rewrite below, or `--version` would become `start --version`.
case "${1:-}" in
    -h|--help|--version)
        exec node "${APP_DIR}/bin/loom.mjs" "$@"
        ;;
esac

# Bare flags (`docker run loom -p 4000`) mean "start with these flags".
if [ "$#" -eq 0 ]; then
    set -- start
elif [ "${1#-}" != "$1" ]; then
    set -- start "$@"
fi

case "$1" in
    start|dev)
        prepare_config
        # The image ships Next's standalone build, which is a self-contained
        # `server.js` rather than the full `next` CLI — so `loom start` has no
        # binary to spawn here. Next's server reads PORT/HOSTNAME, so map the
        # LOOM_* names onto them.
        #
        # Config still applies: lib/server/config.ts runs the same preflight
        # during `ensureInit`, so a mounted loom.config.yaml is honoured. The
        # one exception is `database.path`, which is read at module load before
        # that runs — the image sets LOOM_DB_PATH for exactly this reason.
        export PORT="${LOOM_SERVER_PORT:-3000}"
        export HOSTNAME="${LOOM_SERVER_HOSTNAME:-0.0.0.0}"
        shift
        exec node "${APP_DIR}/server.js" "$@"
        ;;
    init|update)
        exec node "${APP_DIR}/bin/loom.mjs" "$@"
        ;;
    *)
        # Escape hatch: `docker run ... loom sh`, `node -e ...`, etc.
        exec "$@"
        ;;
esac
