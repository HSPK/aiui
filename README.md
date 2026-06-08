<div align="center">

# Loom

**A self-hosted dev portal that weaves LLM providers, MCP tools, and a playground into one OpenAI-compatible surface.**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node 20+](https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg)](#requirements)
[![npm](https://img.shields.io/npm/v/@hspk/loom.svg)](https://www.npmjs.com/package/@hspk/loom)

</div>

---

Spin up a unified `/v1/*` endpoint for OpenAI, Azure, Foundry, DeepSeek, vLLM, Ollama — whatever speaks the OpenAI protocol — and get a polished playground, request logs, MCP tool integration, and per-key access control for free. One binary. One SQLite file. No external services.

```bash
npx @hspk/loom init     # interactive setup wizard
npx @hspk/loom start    # boots http://localhost:3000
```

## Why Loom

- **Drop-in OpenAI gateway.** Point any OpenAI SDK at your Loom URL and it works. Chat, completions, embeddings, rerank, images, speech, transcription, MCP-driven tool calls — all behind one API key.
- **Provider catalog auto-discovered.** Loom hits each provider's `/models` endpoint on demand. No model YAML to maintain. Override display names, deployment IDs, or default params per-model in the admin UI.
- **MCP, properly.** First-class support for the Model Context Protocol: register stdio or HTTP servers, browse the auto-discovered tool catalog, watch the chat playground execute them and stream the results back into the conversation.
- **Built-in playground.** Real conversations against any of your registered models with cost / latency / TTFT counters, request inspector, conversation forking, and tool-call timelines.
- **Single binary, single file.** Ships as one Next.js binary backed by SQLite (WAL mode). No Redis. No Postgres. No separate worker. Move your gateway by copying one `.db` file.
- **Audit trail by default.** Every request is logged with prompt summary, token counts, TTFT, total latency, error class. Browse, filter, export.
- **Encrypted at rest.** Provider API keys are AES-256-GCM encrypted with a master key you control. MCP server configs containing secrets get the same treatment.

## Quick start

### 1. Install

```bash
# global install — recommended for self-hosting
npm install -g @hspk/loom

# or run on demand without installing
npx @hspk/loom <command>
bunx @hspk/loom <command>
```

### 2. Initialize

```bash
loom init
```

A guided wizard asks you:

- Where the config file should live (project / user / custom path)
- Admin username + password (or reference an env var)
- Your first provider (OpenAI / Azure OpenAI / Azure AI Foundry / skip)
- Port and hostname
- Whether to start the server immediately

It writes an `loom.config.yaml` with a freshly generated `master_key` and `chmod 600` permissions.

Need a non-interactive run for CI / Docker?

```bash
loom init --yes --force         # writes a default template
loom init --print > config.yaml # dumps the template to stdout
```

### 3. Run

```bash
loom start              # production server
loom start -p 4000      # custom port
loom dev                # hot-reloading dev mode
```

Visit <http://localhost:3000>, log in with the admin credentials, drop in a real API key, and start chatting.

### 4. Call the gateway

```bash
# Generate an API key in /settings/api-keys, then:
curl http://localhost:3000/api/v1/chat/completions \
  -H "Authorization: Bearer sk-loom-..." \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": true
  }'
```

Or use any OpenAI SDK:

```python
from openai import OpenAI
client = OpenAI(base_url="http://localhost:3000/api/v1", api_key="sk-loom-...")
```

## Surface area

| Endpoint                     | What it does                                         |
| ---------------------------- | ---------------------------------------------------- |
| `POST /api/v1/chat/completions` | Streaming + non-streaming chat                    |
| `POST /api/v1/embeddings`       | Embedding vectors                                 |
| `POST /api/v1/rerank`           | Document reranking                                |
| `POST /api/v1/images/generations` | Image generation                                |
| `POST /api/v1/audio/speech`     | Text-to-speech                                    |
| `POST /api/v1/audio/transcriptions` | Speech-to-text                                |
| `GET  /api/v1/models`           | Live model catalog (discovered from providers)    |

Every request enforces the per-user API key, applies provider/model default params, accepts tool definitions for MCP integration, logs to SQLite, and returns the upstream payload verbatim.

## MCP integration

Loom speaks the Model Context Protocol both as a registry and as a runtime:

1. Register an MCP server (stdio process or HTTP endpoint) in the admin UI
2. Loom probes the server, caches its tool / resource / prompt catalog, and exposes it inline in every chat request
3. When the LLM calls a tool, Loom dispatches to the right MCP server, captures the result, feeds it back into the conversation, and persists the entire tool-call trail with the assistant message

Built-in catalog of probe-verified MCP server presets covers filesystem, git, web search, code execution, academic databases (PubMed, Google Scholar, ArXiv), Notion, Qdrant, Playwright, Pandoc, and more.

## Configuration

`loom.config.yaml` is the single source of truth. Search order:

1. `$LOOM_CONFIG_PATH`
2. `./loom.config.{yaml,yml,json}`
3. `./.config/loom.{yaml,yml,json}`
4. `$XDG_CONFIG_HOME/loom.{yaml,yml,json}` (or `~/.config/...`)

```yaml
master_key: <32-byte hex>     # AES-256-GCM key for provider secrets
admin:
  username: admin
  password: ${LOOM_ADMIN_PASSWORD}
server:
  port: 3000
database:
  path: ./data/loom.db        # default: <cwd>/data/loom.db
providers:
  - name: openai
    base_url: https://api.openai.com/v1
    api_key: ${OPENAI_API_KEY}
```

`${ENV_VAR}` interpolation works in every string field. Environment variables that are already set always win — so production deployments can override anything via secret injection.

## Architecture

Loom is single-binary by design: **Next.js 16 (App Router) + React 19 + Drizzle ORM + better-sqlite3.** No separate backend service.

| Layer            | Lives in                              | Responsibility                                          |
| ---------------- | ------------------------------------- | ------------------------------------------------------- |
| HTTP / SSE       | `app/api/**/route.ts`                 | OpenAI-compatible gateway + admin CRUD + Playground BE |
| Services         | `lib/server/<domain>/`                | Business logic, one folder per domain                  |
| Adapters         | `lib/server/adapters/`                | Per-protocol-variant URL/header/field rules            |
| Capabilities     | `lib/server/capabilities/`            | One file per modality (chat, embed, rerank, …)         |
| Schemas          | `lib/schemas/*.ts`                    | Zod wire types — single source of truth                |
| MCP runtime      | `lib/server/mcp/`                     | Client pool, tool routing, transport lifecycle         |
| Storage          | `lib/server/db/`                      | SQLite + WAL + auto-migrations on boot                 |
| CLI              | `bin/loom.ts` + `lib/cli/`            | citty + @clack/prompts                                 |
| Web UI           | `app/(dashboard)/**` + `components/**` | shadcn/ui + TanStack Query                           |

Adding a new provider protocol variant = one file under `lib/server/adapters/` + one line of registration. Adding a new modality = one file under `lib/server/capabilities/` + one Route Handler. The core gateway never branches on provider type.

## Requirements

- **Node.js ≥ 20**
- A modern OS that can run a native better-sqlite3 binding (Linux / macOS / Windows)
- An API key from at least one upstream provider

## Development

```bash
git clone https://github.com/HSPK/loom.git
cd loom
bun install
bun run dev      # http://localhost:3000 with hot reload
bun run build    # production build
bun run lint
```

Database migrations are generated by Drizzle Kit:

```bash
bunx drizzle-kit generate    # after editing lib/server/db/schema.ts
```

Migrations run automatically on server boot.

## License

MIT © HSPK and contributors. See [LICENSE](LICENSE).

## Contributing

Issues and pull requests are welcome. Please read the [design principles](.github/copilot-instructions.md) before opening a PR — Loom is built around a "minimum churn for new features" philosophy and most changes can be expressed as one new file + one registration line.
