# MCP integration

Loom speaks the [Model Context Protocol](https://modelcontextprotocol.io/) both as a **registry** and as a **runtime**:

1. Register an MCP server (stdio process or HTTP endpoint) in the admin UI
2. Loom probes it, caches its tool / resource / prompt catalog
3. Every chat request to the gateway transparently advertises the available tools to the model
4. When the model calls a tool, Loom dispatches to the right MCP server, captures the result, and feeds it back into the conversation
5. The entire tool-call trail is persisted with the assistant message — searchable in [request logs](logs.md)

## Adding a server

Visit `/mcp` and click **Add MCP server**. Two transports are supported:

### Stdio

```yaml
transport: stdio
config:
  command: npx
  args: ["-y", "@modelcontextprotocol/server-filesystem", "/home/me/projects"]
  env:
    SOME_SECRET: "..."
```

Loom spawns the process on first use, pipes JSON-RPC, and cleans it up on `SIGINT/SIGTERM`. Stdio processes are pooled per-server and auto-evict when the transport closes.

### HTTP

```yaml
transport: http
config:
  url: https://my-mcp-server.example.com
  headers:
    Authorization: "Bearer ${MCP_TOKEN}"
```

## Presets

The **Presets** page (`/mcp/presets`) lists probe-verified server templates grouped by category — filesystem, git, code execution, web search, academic databases, productivity tools, and more. Each preset comes with parameter slots; fill the slots and click "Add" to register.

## Secrets

Server configurations may carry credentials in `env` (stdio) or `headers` (HTTP). Loom encrypts those at rest with the same `master_key`-derived key used for provider API keys.

## How tool calls flow

When an LLM call hits the gateway with `tools: []` or no tools at all, Loom injects every enabled MCP server's tools into the request:

```
user message ─▶ gateway ─▶ inject MCP tools ─▶ upstream provider
                                                      │
                                ◀─ tool_calls[] ──────┘
                                │
                    ┌───────────┴────────────┐
                    ▼                        ▼
              dispatch to MCP        record tool_call event
              server, capture
              result
                    │
                    ▼
              feed result back ─▶ upstream provider ─▶ final reply
```

Every round is logged in `generation_logs` with TTFT and total latency.

## Capability surface

Loom exposes each registered MCP server's full surface:

- **Tools** — discovered via `tools/list`, dispatched via `tools/call`
- **Resources** — discovered via `resources/list`, fetched via `resources/read`
- **Prompts** — discovered via `prompts/list`

Click any server in `/mcp` to see its discovered surface and the raw `server_info` block returned at handshake.

## Adding a new MCP server type

The runtime is registry-based. New transports get a single new file under `lib/server/mcp/` and one line of registration. See the [architecture doc](../architecture.md#mcp-runtime) for details.
