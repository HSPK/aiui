# Architecture

Loom is single-binary by design. The web UI, the API gateway, the MCP runtime, and the CLI all live in one repository and build into one process.

```
                  ┌────────────────────────────────────────┐
                  │              Browser (React)           │
                  │  ┌──────────┐  ┌───────────────────┐   │
                  │  │ Admin UI │  │ Playground (chat, │   │
                  │  │  /logs   │  │ embedding, …)     │   │
                  │  └────┬─────┘  └──────┬────────────┘   │
                  └───────┼───────────────┼────────────────┘
                          │ TanStack Query│
                  ┌───────▼───────────────▼────────────────┐
                  │       Next.js Route Handlers           │
                  │   (one process; node runtime)          │
                  │                                        │
                  │  /api/v1/*  OpenAI-compatible gateway  │
                  │  /api/*     CRUD + Playground backend  │
                  │  /api/mcp/* MCP server registry        │
                  └───────────────┬────────────────────────┘
                                  │
            ┌─────────────────────┼─────────────────────┐
            │                     │                     │
            ▼                     ▼                     ▼
     ┌────────────┐        ┌────────────┐        ┌────────────┐
     │  SQLite    │        │  Upstream  │        │  MCP       │
     │ (WAL mode) │        │ providers  │        │ servers    │
     └────────────┘        └────────────┘        └────────────┘
       conversations         OpenAI / Azure /         stdio / HTTP
       messages              Foundry / vLLM / …       transports
       generation_logs
       users / api_keys
       providers / models
       mcp_servers
```

## Stack

- **Next.js 16 App Router + React 19 + TypeScript strict** for the UI and API
- **SQLite (WAL) via Drizzle ORM + better-sqlite3** for storage; migrations run automatically on boot
- **citty** for the CLI subcommand router
- **@clack/prompts** for the interactive `loom init` wizard
- **TanStack Query + Zustand** for client state
- **shadcn/ui + Tailwind** for the visual layer

There is **no separate backend service**. There is **no Redis**. There is **no Postgres**. State lives in one SQLite file; copy that file to move your installation.

## Layering

| Layer            | Lives in                                | Responsibility                                          |
| ---------------- | --------------------------------------- | ------------------------------------------------------- |
| HTTP / SSE       | `app/api/**/route.ts`                   | OpenAI-compatible gateway, admin CRUD, Playground BE   |
| Services         | `lib/server/<domain>/`                  | Business logic, one folder per domain                   |
| Adapters         | `lib/server/adapters/`                  | Per-protocol-variant URL / header / field rules         |
| Capabilities     | `lib/server/capabilities/`              | One file per modality (chat, embed, rerank, image, …)   |
| Schemas          | `lib/schemas/*.ts`                      | Zod wire types — single source of truth                 |
| MCP runtime      | `lib/server/mcp/`                       | Client pool, tool routing, transport lifecycle          |
| Storage          | `lib/server/db/`                        | SQLite + WAL + auto-migrations on boot                  |
| CLI              | `bin/loom.ts` + `lib/cli/`              | Entry shim + citty subcommand tree                      |
| Web UI           | `app/(dashboard)/**` + `components/**`  | shadcn/ui + TanStack Query                              |

## Adapter layer

The gateway core never branches on provider type. Instead, each upstream protocol variant is one adapter:

```ts
registerAdapter({
    id: "azure-foundry",
    matches: (provider) => provider.base_url.includes("foundry"),
    selectUpstreamApi: (modality) => modality === "chat"
        ? "/v1/chat/completions"
        : "/v1/...",
    transformRequest: (body, modality) => stripUnsupportedFields(body),
    acceptedFields: { /* whitelist */ },
});
```

A new protocol = one new file in `lib/server/adapters/<id>.ts` + one line of registration. The gateway, capability handlers, and admin UI dropdown all pick it up automatically.

## Capability layer

Each modality (chat / embed / rerank / image / speech / transcribe) is one file in `lib/server/capabilities/`. Adding a new modality is:

1. One new file with `registerCapability(...)`
2. One Route Handler that calls `forwardGeneration(user, "<id>", body)`

The gateway's core forwarding logic never changes.

## MCP runtime

`lib/server/mcp/runtime.ts` owns one process-wide pool of MCP clients. On first use of a server, the runtime spawns / connects the transport, caches the discovered tool / resource / prompt catalog, and registers eviction handlers (transport close → drop pool entry, `SIGINT/SIGTERM` → graceful shutdown of every stdio child).

Tool dispatch is a registry lookup: `<server-prefix>__<tool>` → MCP server → `tools/call`.

## Streaming pipeline

For streaming generations (`/api/v1/chat/completions?stream=true`):

```
upstream SSE bytes ─┬─▶ tee to client (verbatim, byte-for-byte)
                    └─▶ tee to log writer
                          - assemble full response from chunks
                          - measure TTFT (first byte)
                          - measure total latency (last byte)
                          - persist on stream close
```

The log writer never blocks the client tee — if logging fails, the response still streams correctly.

## Single-process trade-off

Loom keeps the playground, the gateway, the MCP runtime, and the request log in one Node process backed by one SQLite file. This is a deliberate trade-off:

- **Operational simplicity** — no separate observability service, no Redis, no Postgres, no worker fleet. Back up `data/loom.db` and you back up the entire installation.
- **Auth consistency** — the same API keys apply across the gateway and the playground; the same log row records both.
- **Scale ceiling** — single-process means single-host. Loom targets teams and self-hosted deployments rather than multi-region SaaS workloads. When you outgrow it, your gateway-side traffic is already speaking the OpenAI protocol, so swapping in a horizontal proxy in front is a config change, not a rewrite.
