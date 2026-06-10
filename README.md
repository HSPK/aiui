<div align="center">

# Loom

A self-hosted **AI testing platform** for trying out models and MCP servers,
recording every request, and — when you're ready — fronting your applications
through the same OpenAI-compatible gateway.

[![Release](https://img.shields.io/github/v/release/HSPK/loom?style=flat-square&color=4338ca&label=release)](https://github.com/HSPK/loom/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](LICENSE)
[![Node 20+](https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg?style=flat-square)](#requirements)
[![Docs](https://img.shields.io/badge/docs-mkdocs-success?style=flat-square)](https://hspk.github.io/loom)
[![Docs CI](https://img.shields.io/github/actions/workflow/status/HSPK/loom/docs.yml?branch=main&style=flat-square&label=docs%20build)](https://github.com/HSPK/loom/actions/workflows/docs.yml)

</div>

---

## What it does

Loom gives you, in a single process backed by one SQLite file, three things that
usually live in three separate tools:

1. **A playground** for exercising models and tool flows — side-by-side
   multi-model chat, embedding comparison, MCP tool dispatch, conversation
   branching, live token / TTFT / latency counters.
2. **A request log** that captures the full prompt and full response of every
   call (streamed responses are reassembled from the wire). Search by user,
   model, API key, capability, or free text. Replay any request from its detail
   panel. Query directly with `sqlite3` when you want.
3. **An OpenAI-compatible gateway** at `/api/v1/*` so your applications can hit
   the same providers, same MCP servers, same auth, and end up in the same
   log table as your interactive exploration.

## MCP testing

Loom is built around the Model Context Protocol from day one.

- Register stdio or HTTP MCP servers in the admin UI; secrets in `env` and
  `headers` are encrypted at rest.
- Loom probes each server and caches the discovered tools, resources, and
  prompts. The detail panel shows the raw `server_info` block plus every tool's
  parameter schema.
- A preset catalogue covers common servers (filesystem, git, fetch, search,
  Pandoc, Qdrant, several academic databases, browser automation, …).
  Add-and-fill works for both the playground and the gateway.
- In the chat playground, available tools are advertised automatically; tool
  calls are dispatched, executed, and rendered inline. The full input / output
  trail is persisted alongside the assistant message.
- The same dispatch path runs for production calls hitting `/api/v1/*`, so
  what you debug interactively is what your apps will see.

## Request logs

Every call that touches Loom — playground, gateway, MCP tool dispatch — writes
one row to `generation_logs`. The `/logs` page exposes the table with filters,
detail drawer, and replay; you can also query the SQLite file directly:

```bash
sqlite3 data/loom.db '
  SELECT user, model, count(*) AS n, avg(total_latency_ms) AS avg_ms
  FROM generation_logs
  WHERE created_at > datetime("now", "-7 days")
  GROUP BY user, model ORDER BY n DESC LIMIT 10;
'
```

## Quickstart

### Install

Loom ships as a single Node CLI. Pre-built tarballs are attached to each
GitHub Release (we don't publish to the npm registry).

```bash
# Latest — re-run the same command later to upgrade.
bun add -g https://github.com/HSPK/loom/releases/latest/download/loom.tgz

# Or pin to a specific version:
bun add -g https://github.com/HSPK/loom/releases/download/v1.3.4/loom-1.3.4.tgz
```

`npm i -g <url>` works identically if you prefer npm. No special flags
needed — bun and npm both skip lifecycle scripts on tarball install,
and Loom recreates its install-time symlinks at CLI startup so no
post-install step is necessary.

### Run

```bash
# Interactive setup wizard — picks providers, generates a master key,
# writes loom.config.yaml
loom init

# Start the server
loom start
```

Visit <http://localhost:3000>, sign in with the admin credentials, register
your providers, and start a chat in the playground.

To use Loom as a gateway from your applications:

```python
from openai import OpenAI
client = OpenAI(
    base_url="http://localhost:3000/api/v1",
    api_key="sk-loom-...",  # issued under /settings/api-keys
)
```

The full list of supported modalities (chat, embeddings, rerank, images,
text-to-speech, transcription) lives in the
[API reference](docs/reference/api.md).

## Why a single process

Loom keeps state in one SQLite file and avoids external services. Copy
`data/loom.db` to move your installation; back it up to snapshot the entire
playground history, gateway log, and MCP / provider registry at once.

The same auth model spans playground and gateway: an API key issued for a user
applies everywhere, and every call shows up in the same log table regardless of
where it originated. There is no separate observability service to wire up.

## Requirements

- Node.js ≥ 20
- An OS that can run a native `better-sqlite3` build (Linux / macOS / Windows)
- An API key from at least one upstream LLM provider

## Documentation

Full documentation is published to **<https://hspk.github.io/loom>** and lives
under [`docs/`](docs/). Topic index:

- [Getting started](docs/guide/getting-started.md)
- [Configuration](docs/guide/configuration.md)
- [Providers](docs/guide/providers.md)
- [MCP integration](docs/guide/mcp.md)
- [Playground walkthrough](docs/guide/playground.md)
- [Request logs](docs/guide/logs.md)
- [CLI reference](docs/reference/cli.md)
- [API reference](docs/reference/api.md)
- [Environment variables](docs/reference/env-vars.md)
- [Architecture](docs/architecture.md)
- [Development](docs/development.md)

To build the docs site locally:

```bash
pip install -r docs/requirements.txt
mkdocs serve
```

## Status

Loom is under active development. The public surface (HTTP API, CLI flags,
config file shape) is stabilising but may shift before `1.0`. Pin a specific
version in production until then.

## License

[MIT](LICENSE) — © HSPK and contributors. Issues and pull requests welcome.
