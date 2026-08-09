# Docker deployment

The container image bundles Node, the Next.js server, and the CLI. It is
published to the GitHub Container Registry for `linux/amd64` and `linux/arm64`:

```
ghcr.io/hspk/loom:latest
```

| Tag | What it tracks |
| --- | --- |
| `latest` | The most recent tagged release |
| `1.4.8`, `1.4`, `1` | A specific release / minor line / major line |
| `edge` | The current `main` branch (amd64 only) |
| `sha-<short>` | An exact commit |

Pin a version in production — `latest` moves under you.

## Run

```bash
docker run -d \
  --name loom \
  -p 3000:3000 \
  -v loom-data:/data \
  --restart unless-stopped \
  ghcr.io/hspk/loom:latest
```

Then read the log for the generated admin password:

```bash
docker logs loom
```

```
[loom:docker] generated /data/loom.config.yaml

  ┌────────────────────────────────────────────────────────┐
  │  First-run admin credentials (shown once)
  │
  │    username : admin
  │    password : 8AL-WwOrRv4_diT0
  │
  └────────────────────────────────────────────────────────┘
```

Open <http://localhost:3000> and sign in.

## Docker Compose

```bash
curl -fsSLO https://raw.githubusercontent.com/HSPK/loom/main/docker-compose.yml
docker compose up -d
docker compose logs -f loom
```

```yaml title="docker-compose.yml"
services:
  loom:
    image: ghcr.io/hspk/loom:latest
    container_name: loom
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      LOOM_MASTER_KEY: ${LOOM_MASTER_KEY:-}
      LOOM_ADMIN_USERNAME: ${LOOM_ADMIN_USERNAME:-admin}
      LOOM_ADMIN_PASSWORD: ${LOOM_ADMIN_PASSWORD:-}
      OPENAI_API_KEY: ${OPENAI_API_KEY:-}
    volumes:
      - loom-data:/data
      - loom-cache:/home/node/.cache
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      start_period: 30s
      retries: 3

volumes:
  loom-data:
  loom-cache:
```

Put your values in a `.env` file next to the compose file:

```bash title=".env"
LOOM_MASTER_KEY=<openssl rand -base64 32>
LOOM_ADMIN_PASSWORD=<choose one>
OPENAI_API_KEY=sk-...
```

## Configuration

Three ways to configure the container, highest precedence first.

### 1. Environment variables

Every `LOOM_*` variable from the [env var reference](../reference/env-vars.md)
works, and env vars always beat the config file:

```bash
docker run -d -p 3000:3000 -v loom-data:/data \
  -e LOOM_MASTER_KEY="$(openssl rand -base64 32)" \
  -e LOOM_ADMIN_PASSWORD='choose-something-strong' \
  -e OPENAI_API_KEY=sk-... \
  ghcr.io/hspk/loom:latest
```

Set both `LOOM_MASTER_KEY` and `LOOM_ADMIN_PASSWORD` and the entrypoint skips
config generation entirely — useful when secrets come from Kubernetes,
Swarm, or your orchestrator's secret store.

!!! warning "Keep the master key stable"

    `LOOM_MASTER_KEY` decrypts every stored provider and MCP credential.
    Change it and existing secrets become unreadable — you'll have to
    re-enter every API key.

### 2. A mounted config file

Manage providers declaratively by mounting a `loom.config.yaml` anywhere in
[the search order](configuration.md) — `/app/loom.config.yaml` is the natural
spot:

```bash
docker run -d -p 3000:3000 \
  -v loom-data:/data \
  -v "$PWD/loom.config.yaml:/app/loom.config.yaml:ro" \
  -e OPENAI_API_KEY=sk-... \
  ghcr.io/hspk/loom:latest
```

The file may reference env vars (`api_key: ${OPENAI_API_KEY}`), so secrets
never have to be baked into it.

### 3. Auto-generated (the default)

With neither of the above, the entrypoint writes `/data/loom.config.yaml` on
first start, containing a random `master_key` and admin credentials. Because
it lives on the volume, restarts and upgrades keep the same key.

## Data and backups

Everything — SQLite database and generated config — lives under `/data`:

| Path | Contents |
| --- | --- |
| `/data/loom.db` | Conversations, request logs, providers, MCP servers, users, API keys |
| `/data/loom.config.yaml` | Master key + admin bootstrap (auto-generated) |

Backing up is a file copy. Stop the container first so SQLite's WAL is
checkpointed:

```bash
docker stop loom
docker run --rm -v loom-data:/data -v "$PWD:/backup" alpine \
  tar czf /backup/loom-backup.tar.gz -C /data .
docker start loom
```

Restore into a fresh volume:

```bash
docker run --rm -v loom-data:/data -v "$PWD:/backup" alpine \
  tar xzf /backup/loom-backup.tar.gz -C /data
```

Or query the database in place:

```bash
docker exec -it loom node -e "
  const db = require('better-sqlite3')('/data/loom.db', { readonly: true });
  console.table(db.prepare('SELECT model, count(*) n FROM generation_logs GROUP BY model').all());
"
```

### Bind mounts

A named volume inherits the image's ownership and Just Works. A bind mount
does not — the container runs as uid `1000` (`node`), so chown the host
directory first:

```bash
mkdir -p ./loom-data && sudo chown -R 1000:1000 ./loom-data
docker run -d -p 3000:3000 -v "$PWD/loom-data:/data" ghcr.io/hspk/loom:latest
```

## Upgrading

```bash
docker compose pull && docker compose up -d
```

With plain `docker run`, recreate the container against the same volume:

```bash
docker pull ghcr.io/hspk/loom:latest
docker rm -f loom
docker run -d --name loom -p 3000:3000 -v loom-data:/data \
  --restart unless-stopped ghcr.io/hspk/loom:latest
```

Schema migrations run automatically at startup. The volume carries your data
across the upgrade — nothing else to do.

## Behind a reverse proxy

Set `LOOM_TRUST_PROXY=1` so Loom trusts `X-Forwarded-For` when identifying
clients — without it every request looks like it came from the proxy, and the
login rate limiter falls back to its conservative per-username policy.

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # Streaming responses must not be buffered.
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;
}
```

`proxy_buffering off` matters: without it, SSE tokens arrive in bursts and
the time-to-first-token metric becomes meaningless.

## MCP servers

Most MCP servers are not libraries — they are subprocesses the container has
to spawn. The image therefore ships the two ecosystems the built-in catalogue
draws from, so stdio presets work without a custom image:

| Runtime | Serves |
| --- | --- |
| `node` / `npx` | The TypeScript reference servers (`npx -y @modelcontextprotocol/server-*`) |
| `uv` / `uvx` + `python3` | The Python servers (`uvx mcp-server-*`) |
| `git` | Required by the `git` preset, which shells out rather than using a library |

Without these you get `spawn uvx ENOENT` (or `spawn npx ENOENT`) the moment a
server starts.

Both launchers download the server package on first run and cache it under
`$HOME` (`/home/node`). That works out of the box, but the cache is lost when
the container is recreated, so every upgrade re-downloads. Both caches live
under one directory so a single volume keeps them:

```yaml
volumes:
  - loom-data:/data
  - loom-cache:/home/node/.cache   # uv + npm package cache
```

The image creates that directory owned by `node` on purpose. Docker seeds a
new named volume from whatever the image has at the mount point, so if the
path did not exist you would get an empty **root-owned** volume — and then
every `uvx` server fails on an unwritable cache while the `npx` ones keep
working, which is a memorably confusing way to spend an afternoon.

If you run the container with a custom `--user`, set `HOME` to a directory
that user can write to — `uvx` and `npx` both fail on an unwritable `$HOME`.

### Pinned versions in the catalogue

Six presets (`time`, `fetch`, `git`, `sqlite`, `scholarly`, `pubmed`) pass
`--with "mcp<2"`. This is not cosmetic: the `mcp` Python SDK 2.0 is a breaking
release — `McpError` became `MCPError`, `Server.list_tools` was dropped,
`mcp.server.fastmcp` moved — and those packages declare an unbounded
dependency on it, so an unpinned `uvx` run dies before the MCP handshake. The
failure is not always the same exception, which is why the list is longer than
it first looked. Drop the pin once the upstream packages are fixed.

## Other commands

The entrypoint forwards unknown commands straight through, so the container
doubles as a CLI:

```bash
docker run --rm ghcr.io/hspk/loom:latest --version
docker run --rm ghcr.io/hspk/loom:latest init --print > loom.config.yaml
docker exec -it loom sh
```

## Building the image yourself

```bash
git clone https://github.com/HSPK/loom.git && cd loom
docker build -t loom .
docker run -d -p 3000:3000 -v loom-data:/data loom
```

The build is multi-stage: a builder compiles the Next.js app and the CLI
bundle, a second stage resolves the lockfile without devDependencies, and the
runtime stage carries no compilers. The app ships as a Next.js
[standalone](https://nextjs.org/docs/app/api-reference/config/next-config-js/output)
server, which traces the modules actually imported instead of copying
`node_modules` wholesale — that is the difference between a ~600 MB dependency
tree and ~55 MB, and it is why the image has room for the Python and Node MCP
runtimes above. Override the Node or Bun version with build args:

```bash
docker build --build-arg NODE_VERSION=22 --build-arg BUN_VERSION=1.3.14 -t loom .
```

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `/data is not writable by uid 1000` | Bind mount owned by root — `sudo chown -R 1000:1000 <hostdir>` |
| `No users in database and LOOM_ADMIN_PASSWORD is not set` | A config was mounted without an `admin:` block. Pass `-e LOOM_ADMIN_PASSWORD=...` |
| Stored provider keys stopped decrypting | `LOOM_MASTER_KEY` changed. Restore the old key, or re-enter the provider keys |
| Container is `unhealthy` | `docker logs loom`. The healthcheck probes `/api/health` on `$LOOM_SERVER_PORT` |
| Streaming feels chunky | Disable proxy buffering (see above) |
| `spawn uvx ENOENT` / `spawn npx ENOENT` | You are on a custom image without the MCP runtimes, or you overrode `PATH` |
| An MCP server dies immediately with `ImportError: cannot import name 'McpError'`, `AttributeError: 'Server' object has no attribute 'list_tools'`, or `ModuleNotFoundError: mcp.server.fastmcp` | The package resolved `mcp` 2.x. Add `--with "mcp<2"` before the package name in its args |
| MCP servers re-download after every upgrade | The `$HOME` cache is not on a volume — see [MCP servers](#mcp-servers) |
