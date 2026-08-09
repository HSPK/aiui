# syntax=docker/dockerfile:1

# Loom container image.
#
#   docker build -t loom .
#   docker run -p 3000:3000 -v loom-data:/data loom
#
# Layout mirrors the published npm tarball: package.json + node_modules +
# .next + drizzle + public + bin/loom.mjs, all rooted at /app. The CLI shim
# derives LOOM_PACKAGE_ROOT from its own location, so `node bin/loom.mjs
# start` resolves migrations and the embedded Next server correctly.
#
# Node major MUST match between the build and runtime stages: better-sqlite3
# compiles against a specific Node ABI.

ARG NODE_VERSION=22
ARG BUN_VERSION=1.3.14

# --------------------------------------------------------------------------
# base — Node + Bun + a toolchain for better-sqlite3's native build
# --------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS base
ARG BUN_VERSION
ENV CI=1 \
    NEXT_TELEMETRY_DISABLED=1 \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates python3 make g++ \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g "bun@${BUN_VERSION}"
WORKDIR /app

# --------------------------------------------------------------------------
# build — full dependency tree, Next.js production build, CLI bundle
# --------------------------------------------------------------------------
FROM base AS build

# `prepare` (bun install) bundles bin/loom.ts, which pulls in lib/cli/** —
# copy those before installing so the dependency layer still caches on
# package.json / bun.lock changes alone.
COPY package.json bun.lock ./
COPY scripts ./scripts
COPY bin ./bin
COPY lib ./lib
RUN bun install --frozen-lockfile

COPY . .

# `next build` collects page data in parallel workers; each one imports server
# code and opens SQLite, and they race each other's `PRAGMA journal_mode=WAL`
# on the shared file (SQLITE_BUSY). Migrations are already skipped at build
# time, so a private in-memory database per worker removes the contention.
ENV LOOM_DB_PATH=:memory:

# NOTE: deliberately does NOT run `scripts/prepack-trim.mjs`. That script is
# the npm-pack step and strips `.next/standalone`, which is precisely what this
# image ships. The two distribution paths trim different things.
RUN bun run build

# --------------------------------------------------------------------------
# prod-deps — the same lockfile resolved without devDependencies
# --------------------------------------------------------------------------
FROM base AS prod-deps
COPY package.json bun.lock ./
# `prepare`/`prepack` need devDeps (esbuild) and the source tree, neither of
# which belongs in a production install. Drop them; the runtime stage copies
# the pristine package.json back in.
#
# The final `rm -rf` drops two classes of dead weight:
#   - musl variants of the SWC and sharp binaries (~140 MB). Bun materialises
#     every optional platform variant, and this image is glibc.
#   - playwright-core (~14 MB). `--production` prunes devDependencies but not
#     their *peer* dependencies, and @axe-core/playwright declares
#     playwright-core as a peer — so a browser automation stack shipped in the
#     server image.
RUN node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));for(const s of ['prepare','prepack','prepublishOnly'])delete p.scripts[s];fs.writeFileSync('package.json',JSON.stringify(p,null,2))" \
    && bun install --frozen-lockfile --production \
    && rm -rf node_modules/@next/swc-*-musl \
              node_modules/@img/sharp-linuxmusl-* \
              node_modules/@img/sharp-libvips-linuxmusl-* \
              node_modules/playwright-core \
              node_modules/@playwright

# --------------------------------------------------------------------------
# runtime — no compilers, no devDependencies, non-root
# --------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime

# uv/uvx come from the official image rather than a curl|sh install: it is a
# pinned, signed artifact and adds no package manager state to this layer.
COPY --from=ghcr.io/astral-sh/uv:0.9.29 /uv /uvx /usr/local/bin/

# ca-certificates: outbound TLS to upstream providers.
# tini: PID 1 that reaps child processes and forwards signals — this matters
#   more than usual here, because every stdio MCP server is a child process.
# python3 / git: stdio MCP servers are launched as `uvx <server>` (11 of the
#   built-in presets) or `npx <server>` (10 more). uvx needs a Python to run
#   the tool, and the git MCP server shells out to git. npx ships with node.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates tini git python3 python3-venv \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Next's standalone output: server.js plus only the dependencies the server
# actually reaches. Static assets and public/ are not traced, so they are
# copied separately.
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static     ./.next/static
COPY --from=build --chown=node:node /app/public           ./public
COPY --from=build --chown=node:node /app/drizzle          ./drizzle
# The CLI bundle stays for `docker run <image> init --print` and friends.
COPY --from=build --chown=node:node /app/bin/loom.mjs     ./bin/loom.mjs
COPY --chown=node:node docker/entrypoint.sh /usr/local/bin/loom-entrypoint

RUN chmod +x /usr/local/bin/loom-entrypoint \
    && mkdir -p /data /home/node/.cache/uv /home/node/.cache/npm \
    && chown -R node:node /data /home/node

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    LOOM_DB_PATH=/data/loom.db \
    LOOM_SERVER_HOSTNAME=0.0.0.0 \
    LOOM_SERVER_PORT=3000 \
    # Set explicitly: uvx and npx both need a writable HOME for their caches,
    # and Docker does not always derive one from USER.
    #
    # Both caches live under a single directory so one volume mounted at
    # /home/node/.cache covers both launchers. The directory is created and
    # chowned above for the same reason: Docker seeds a new named volume from
    # whatever the image has at the mount point, so if the path doesn't exist
    # the volume is created empty and owned by root — and every `uvx` MCP
    # server then dies on an unwritable cache while `npx` ones carry on,
    # which is a thoroughly confusing way to find out.
    HOME=/home/node \
    UV_CACHE_DIR=/home/node/.cache/uv \
    NPM_CONFIG_CACHE=/home/node/.cache/npm

USER node
EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.LOOM_SERVER_PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/loom-entrypoint"]
CMD ["start"]

LABEL org.opencontainers.image.title="Loom" \
      org.opencontainers.image.description="Self-hosted AI testing platform — model & MCP playground, full request logs, and an OpenAI-compatible gateway." \
      org.opencontainers.image.source="https://github.com/HSPK/loom" \
      org.opencontainers.image.documentation="https://hspk.github.io/loom" \
      org.opencontainers.image.licenses="MIT"
