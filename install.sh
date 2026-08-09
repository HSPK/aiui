#!/bin/sh
# ---------------------------------------------------------------------------
# Loom installer
#
#   curl -fsSL https://raw.githubusercontent.com/HSPK/loom/main/install.sh | sh
#
# Pass options after `-s --`:
#
#   curl -fsSL .../install.sh | sh -s -- --version 1.4.8
#   curl -fsSL .../install.sh | sh -s -- --package-manager npm
#   curl -fsSL .../install.sh | sh -s -- --uninstall
#
# Or via environment variables:
#
#   LOOM_VERSION=1.4.8 curl -fsSL .../install.sh | sh
#
# What it does: downloads the prebuilt tarball attached to a GitHub Release
# and installs it globally with bun (preferred) or npm. Loom is NOT published
# to the npm registry -- the release tarball is the distribution channel.
#
# POSIX sh only. No bashisms, no dependencies beyond curl-or-wget plus a
# package manager.
# ---------------------------------------------------------------------------

set -eu

REPO="HSPK/loom"
RELEASES_API="https://api.github.com/repos/${REPO}/releases/latest"
LATEST_TARBALL="https://github.com/${REPO}/releases/latest/download/loom.tgz"
MIN_NODE_MAJOR=20

VERSION="${LOOM_VERSION:-}"
PM="${LOOM_INSTALL_PM:-}"
DO_UNINSTALL=0
DRY_RUN=0

# ---- output ---------------------------------------------------------------

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
    BOLD=$(printf '\033[1m'); DIM=$(printf '\033[2m'); RESET=$(printf '\033[0m')
    RED=$(printf '\033[31m'); GREEN=$(printf '\033[32m')
    YELLOW=$(printf '\033[33m'); CYAN=$(printf '\033[36m')
else
    BOLD=""; DIM=""; RESET=""; RED=""; GREEN=""; YELLOW=""; CYAN=""
fi

say()  { printf '%s\n' "$*"; }
info() { printf '%s==>%s %s\n' "$CYAN" "$RESET" "$*"; }
ok()   { printf '%s[ok]%s %s\n' "$GREEN" "$RESET" "$*"; }
warn() { printf '%s[!]%s %s\n' "$YELLOW" "$RESET" "$*" >&2; }
die()  { printf '%s[x]%s %s\n' "$RED" "$RESET" "$*" >&2; exit 1; }

usage() {
    cat <<USAGE
${BOLD}Loom installer${RESET}

Usage: install.sh [options]

Options:
  -v, --version <ver>          Install a specific version (e.g. 1.4.8 or v1.4.8).
                               Default: the latest GitHub Release.
  -p, --package-manager <pm>   Force "bun" or "npm". Default: bun if present, else npm.
      --uninstall              Remove a global Loom install.
      --dry-run                Print what would happen, change nothing.
  -h, --help                   Show this help.

Environment:
  LOOM_VERSION       Same as --version
  LOOM_INSTALL_PM    Same as --package-manager
  NO_COLOR           Disable coloured output

Docs: https://hspk.github.io/loom
USAGE
}

# ---- arg parsing ----------------------------------------------------------

while [ $# -gt 0 ]; do
    case "$1" in
        -v|--version)          VERSION="${2:-}"; [ -n "$VERSION" ] || die "--version needs a value"; shift 2 ;;
        --version=*)           VERSION="${1#*=}"; shift ;;
        -p|--package-manager)  PM="${2:-}"; [ -n "$PM" ] || die "--package-manager needs a value"; shift 2 ;;
        --package-manager=*)   PM="${1#*=}"; shift ;;
        --uninstall)           DO_UNINSTALL=1; shift ;;
        --dry-run)             DRY_RUN=1; shift ;;
        -h|--help)             usage; exit 0 ;;
        *)                     die "Unknown option: $1 (try --help)" ;;
    esac
done

has() { command -v "$1" >/dev/null 2>&1; }

run() {
    if [ "$DRY_RUN" -eq 1 ]; then
        printf '%s[dry-run]%s %s\n' "$DIM" "$RESET" "$*"
        return 0
    fi
    "$@"
}

# ---- http -----------------------------------------------------------------

fetch() {
    if has curl; then
        curl -fsSL "$1"
    elif has wget; then
        wget -qO- "$1"
    else
        die "Neither curl nor wget is available."
    fi
}

have_downloader() { has curl || has wget; }

url_exists() {
    if has curl; then
        curl -fsIL -o /dev/null "$1" 2>/dev/null
    elif has wget; then
        wget -q --spider "$1" 2>/dev/null
    else
        return 1
    fi
}

# ---- preflight ------------------------------------------------------------

check_node() {
    has node || die "Node.js >= ${MIN_NODE_MAJOR} is required but 'node' was not found.
  Install it from https://nodejs.org, or with a version manager:
    ${DIM}fnm install 22   |   nvm install 22   |   mise use -g node@22${RESET}"

    node_version=$(node --version 2>/dev/null | sed 's/^v//')
    node_major=${node_version%%.*}
    case "$node_major" in
        ''|*[!0-9]*)
            warn "Could not parse Node version ('${node_version}') -- continuing anyway."
            return 0
            ;;
    esac
    if [ "$node_major" -lt "$MIN_NODE_MAJOR" ]; then
        die "Node.js >= ${MIN_NODE_MAJOR} is required, found v${node_version}."
    fi
    ok "Node.js v${node_version}"
}

detect_pm() {
    if [ -n "$PM" ]; then
        case "$PM" in
            bun|npm) ;;
            *) die "Unsupported package manager '${PM}' (use bun or npm)." ;;
        esac
        has "$PM" || die "'${PM}' was requested but is not installed."
        printf '%s' "$PM"
        return 0
    fi
    if has bun; then printf 'bun'; return 0; fi
    if has npm; then printf 'npm'; return 0; fi
    die "Neither 'bun' nor 'npm' was found.
  Install one of them first:
    ${DIM}curl -fsSL https://bun.sh/install | bash${RESET}
  (npm ships with most Node.js distributions.)"
}

# ---- version / url resolution --------------------------------------------

latest_version() {
    fetch "$RELEASES_API" 2>/dev/null \
        | tr ',' '\n' \
        | grep '"tag_name"' \
        | head -n1 \
        | sed 's/.*"tag_name"[[:space:]]*:[[:space:]]*"//; s/".*$//; s/^v//' \
        || true
}

resolve_tarball_url() {
    if [ -z "$VERSION" ]; then
        printf '%s' "$LATEST_TARBALL"
        return 0
    fi
    bare=${VERSION#v}
    tag="v${bare}"
    versioned="https://github.com/${REPO}/releases/download/${tag}/loom-${bare}.tgz"
    aliased="https://github.com/${REPO}/releases/download/${tag}/loom.tgz"
    # Without curl/wget we can't probe; hand the canonical URL to the package
    # manager and let it surface a real 404 instead of guessing.
    if ! have_downloader; then
        printf '%s' "$versioned"
        return 0
    fi
    if url_exists "$versioned"; then
        printf '%s' "$versioned"
    elif url_exists "$aliased"; then
        printf '%s' "$aliased"
    else
        die "No release tarball found for ${tag}.
  Browse the published releases: https://github.com/${REPO}/releases"
    fi
}

# ---- install / uninstall --------------------------------------------------

pm_install() {
    case "$1" in
        bun) run bun add -g "$2" ;;
        npm) run npm install -g "$2" ;;
    esac
}

pm_remove() {
    case "$1" in
        bun) run bun remove -g loom ;;
        npm) run npm rm -g loom ;;
    esac
}

pm_bin_dir() {
    case "$1" in
        bun) printf '%s' "${BUN_INSTALL:-$HOME/.bun}/bin" ;;
        npm) npm prefix -g 2>/dev/null | sed 's|$|/bin|' ;;
    esac
}

check_path() {
    bindir=$(pm_bin_dir "$1")
    [ -n "$bindir" ] || return 0
    case ":${PATH}:" in
        *":${bindir}:"*) return 0 ;;
    esac
    warn "${bindir} is not on your PATH."
    say "  Add it to your shell profile:"
    say "    ${DIM}export PATH=\"${bindir}:\$PATH\"${RESET}"
}

do_uninstall() {
    pm=$(detect_pm)
    info "Removing Loom via ${BOLD}${pm}${RESET}"
    pm_remove "$pm"
    ok "Loom uninstalled."
    say ""
    say "Your data was left untouched. To remove that too:"
    say "  ${DIM}rm -rf ./data/loom.db* ./loom.config.yaml ~/.config/loom.yaml${RESET}"
}

do_install() {
    printf '\n%sLoom%s - self-hosted AI testing platform\n' "$BOLD" "$RESET"
    printf '%shttps://github.com/%s%s\n\n' "$DIM" "$REPO" "$RESET"

    check_node
    pm=$(detect_pm)
    ok "Package manager: ${pm}"

    url=$(resolve_tarball_url)
    if [ -n "$VERSION" ]; then
        info "Installing Loom v${VERSION#v}"
    else
        latest=$(latest_version)
        if [ -n "$latest" ]; then
            info "Installing Loom v${latest} (latest)"
        else
            info "Installing Loom (latest)"
        fi
    fi
    say "  ${DIM}${url}${RESET}"

    pm_install "$pm" "$url" || die "Install failed. Retry with --package-manager npm, or install manually:
    ${DIM}${pm} add -g ${url}${RESET}"

    if [ "$DRY_RUN" -eq 1 ]; then
        say ""
        ok "Dry run complete -- nothing was changed."
        return 0
    fi

    say ""
    if has loom; then
        installed=$(loom --version 2>/dev/null | tail -n1 || true)
        ok "Installed: loom ${installed}"
    else
        ok "Installed."
        check_path "$pm"
    fi

    cat <<NEXTSTEPS

${BOLD}Next steps${RESET}

  ${CYAN}loom init${RESET}     Interactive setup - writes loom.config.yaml with a fresh master key
  ${CYAN}loom start${RESET}    Start the server on http://localhost:3000

  Upgrade later with ${CYAN}loom update${RESET}, or re-run this installer.

Docs: ${DIM}https://hspk.github.io/loom${RESET}
NEXTSTEPS
}

if [ "$DO_UNINSTALL" -eq 1 ]; then
    do_uninstall
else
    do_install
fi
