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

RUN bun run build \
    && node scripts/prepack-trim.mjs

# --------------------------------------------------------------------------
# prod-deps — the same lockfile resolved without devDependencies
# --------------------------------------------------------------------------
FROM base AS prod-deps
COPY package.json bun.lock ./
# `prepare`/`prepack` need devDeps (esbuild) and the source tree, neither of
# which belongs in a production install. Drop them; the runtime stage copies
# the pristine package.json back in.
#
# The final `rm -rf` clears the musl platform variants of the SWC and sharp
# binaries (~140 MB): bun materialises every optional variant, and this image
# is glibc, so they can never be loaded.
RUN node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));for(const s of ['prepare','prepack','prepublishOnly'])delete p.scripts[s];fs.writeFileSync('package.json',JSON.stringify(p,null,2))" \
    && bun install --frozen-lockfile --production \
    && rm -rf node_modules/@next/swc-*-musl \
              node_modules/@img/sharp-linuxmusl-* \
              node_modules/@img/sharp-libvips-linuxmusl-*

# --------------------------------------------------------------------------
# runtime — no compilers, no devDependencies, non-root
# --------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime

# ca-certificates: outbound TLS to upstream providers.
# tini: PID 1 that reaps the `next start` child and forwards signals.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build     --chown=node:node /app/.next        ./.next
COPY --from=build     --chown=node:node /app/bin/loom.mjs ./bin/loom.mjs
COPY --from=build     --chown=node:node /app/drizzle      ./drizzle
COPY --from=build     --chown=node:node /app/public       ./public
COPY --chown=node:node package.json LICENSE README.md ./
COPY --chown=node:node docker/entrypoint.sh /usr/local/bin/loom-entrypoint

RUN chmod +x /usr/local/bin/loom-entrypoint \
    && mkdir -p /data \
    && chown node:node /data

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    LOOM_DB_PATH=/data/loom.db \
    LOOM_SERVER_HOSTNAME=0.0.0.0 \
    LOOM_SERVER_PORT=3000

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
