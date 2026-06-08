<div align="center">

<h1>Loom</h1>

**One self-hosted process that ties your LLM providers, MCP tools, request logs, and a polished playground together.**

[![npm](https://img.shields.io/npm/v/@hspk/loom?style=flat-square&color=4338ca&label=%40hspk%2Floom)](https://www.npmjs.com/package/@hspk/loom)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](LICENSE)
[![Node 20+](https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg?style=flat-square)](#requirements)
[![Docs](https://img.shields.io/badge/docs-mkdocs-success?style=flat-square)](https://hspk.github.io/loom)
[![Docs CI](https://img.shields.io/github/actions/workflow/status/HSPK/loom/docs.yml?branch=main&style=flat-square&label=docs%20build)](https://github.com/HSPK/loom/actions/workflows/docs.yml)

<sub>Single binary · SQLite-only state · Forensic-grade per-request logs · Multi-modal under one auth · MCP native</sub>

</div>

---

## The pitch

Most "AI gateway" tools force you to choose:

- A **reverse proxy** that ships zero UI and pushes logs to a paid SaaS — _you end up with no way to inspect what your team is doing._
- A **pretty playground** with no gateway protocol — _your apps still talk to providers directly, so your logs, your auth, and your usage caps live in three different places._
- A **distributed system** that needs Redis, Postgres, and a worker fleet — _you spend a weekend wiring infrastructure before you can answer "what did Bob ask GPT-4 yesterday?"_

Loom is what happens when one process owns all of it. **One Node binary, one SQLite file, one auth model, one log table.** That's it.

```bash
npx @hspk/loom init      # interactive setup wizard
npx @hspk/loom start     # boots http://localhost:3000
```

You get a gateway, a playground, MCP tool dispatch, and per-request forensics — without standing up a fleet.

---

## What's different about Loom

> If a feature exists in every "AI gateway" repo on GitHub, it's not listed here.

### 🪶 Truly local

One Node process. One SQLite file. **No Redis, no Postgres, no message queue, no background workers.** `data/loom.db` is your installation — copy it to move, back it up to snapshot, delete it to reset. The full state of your gateway is in one file you can `scp` anywhere.

### 🔬 Every request, every byte, recorded

Loom doesn't just count tokens — it captures the **full request and full response** of every call (streamed responses are reassembled from the wire). Search, replay, export. Filter by user, by model, by API key, by status, by free-text in the prompt body. Audit with `sqlite3`, no telemetry pipeline required.

```bash
sqlite3 data/loom.db '
  SELECT user, model, count(*) AS n, avg(total_latency_ms) AS avg_ms
  FROM generation_logs
  WHERE created_at > datetime("now", "-7 days")
  GROUP BY user, model ORDER BY n DESC LIMIT 10;
'
```

Most gateways either drop logs or charge per event. Loom files them next to the data they describe.

### 🎛️ Same auth, every modality

Chat, embeddings, rerank, image generation, text-to-speech, transcription — **all behind the same API key, the same per-user caps, the same dashboard**. Want to issue Alice a key that can call `gpt-4o-mini` for chat but only `text-embedding-3-small` for vectors? One row. Want the audit log to span every modality? One table.

Most products do chat-only and tell you to "build your own" for the rest.

### 🔌 MCP as a first-class citizen

Register a Model Context Protocol server once, in the admin UI. From that point on:

- Tools surface automatically in every chat request
- The model's tool calls are dispatched, executed, and fed back **inside the gateway** — no client-side glue
- The full tool-call trail is persisted in the same log row as the parent message
- The playground renders the trail inline with collapsible inspection

Stdio and HTTP transports both work. Encrypted-at-rest configs for secrets in `env` / headers. Auto-evict on transport close. Process cleanup on `SIGINT/SIGTERM`.

### 🧪 A playground that uses your real providers

The chat playground is **not a sandbox**. It hits the same `/api/v1/*` endpoints, the same providers, the same MCP servers, gated by the same auth as your applications. What you see while iterating is exactly what your services will see in production — with side-by-side multi-model streaming, per-conversation settings, conversation branching, and live TTFT / token / latency counters baked in.

### 🛠️ Built to extend

The codebase is structured around the principle that **a new feature should be one file plus one registration line**. Adding a new upstream protocol (Anthropic-native, Bedrock, …) doesn't touch the gateway core — it's one adapter in `lib/server/adapters/<id>.ts` and an import. Same for new modalities, new MCP transports, new CLI subcommands, new admin pages. See [Architecture](docs/architecture.md) for the full picture.

---

## 30-second quickstart

```bash
# Install
npm install -g @hspk/loom

# Interactive setup — picks providers, generates master_key, writes config
loom init

# Start the server
loom start

# Issue a key in /settings/api-keys, then:
curl http://localhost:3000/api/v1/chat/completions \
  -H "Authorization: Bearer sk-loom-..." \
  -H "Content-Type: application/json" \
  -d '{ "model": "gpt-4o-mini", "messages": [{"role":"user","content":"Hello"}], "stream": true }'
```

Any OpenAI SDK works as a drop-in:

```python
from openai import OpenAI
client = OpenAI(base_url="http://localhost:3000/api/v1", api_key="sk-loom-...")
```

---

## Requirements

- **Node.js ≥ 20**
- An OS that can run a native `better-sqlite3` build (Linux / macOS / Windows)
- An API key from at least one upstream LLM provider

---

## Documentation

Full documentation lives in [`docs/`](docs/) and is published to **<https://hspk.github.io/loom>** (mkdocs material).

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
pip install mkdocs-material
mkdocs serve
```

---

## Status

Loom is under active development. The public surface (HTTP API, CLI flags, config file shape) is stabilising but may shift before `1.0`. Pin a specific version in production until then.

## License

[MIT](LICENSE) — © HSPK and contributors. Issues and pull requests welcome.
