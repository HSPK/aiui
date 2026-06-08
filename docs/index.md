# Loom

> A self-hosted AI portal — gateway, playground, MCP, and forensic-grade request logs in a single binary.

Loom is what you reach for when you want every LLM call your team makes to flow through one self-hosted process you can inspect, cap, replay, and own.

## At a glance

- **One binary, one SQLite file.** No external services to deploy or maintain.
- **Every request, recorded.** Prompts, token counts, TTFT, total latency, error class — searchable and replayable.
- **Modality parity.** Chat, embeddings, rerank, images, speech, transcription — all behind the same auth, the same logs, the same dashboard.
- **MCP everywhere.** Register Model Context Protocol servers once; tool calls flow through both the gateway and the playground.
- **Playground that uses real providers.** Iterate against your live providers and per-key access controls, not a mocked sandbox.

## Documentation map

- [Getting started](guide/getting-started.md) — install, init, first request
- [Configuration](guide/configuration.md) — config file, env vars, search order
- [Providers](guide/providers.md) — register upstreams, override model params
- [MCP integration](guide/mcp.md) — connect MCP servers and use their tools
- [Playground](guide/playground.md) — chat, embedding, multi-model compare
- [Request logs](guide/logs.md) — search, replay, audit
- [CLI reference](reference/cli.md) — every flag for every subcommand
- [API reference](reference/api.md) — `/api/v1/*` endpoints
- [Environment variables](reference/env-vars.md) — `LOOM_*` precedence rules
- [Architecture](architecture.md) — how the pieces fit together
- [Development](development.md) — local setup, conventions, contributing

## Project status

Loom is under active development. The public surface (HTTP API, CLI flags, config file shape) is stabilising but may still change before `1.0`. Pin a specific version in production until `1.0.0` ships.

## License

[MIT](https://github.com/HSPK/loom/blob/main/LICENSE) — © HSPK and contributors.
