# Loom

> A self-hosted AI testing platform for trying out models and MCP servers,
> recording every request, and fronting your applications through the same
> OpenAI-compatible gateway.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/HSPK/loom/main/install.sh | sh
# or
docker run -d -p 3000:3000 -v loom-data:/data ghcr.io/hspk/loom:latest
```

See [Getting started](guide/getting-started.md) for every install route, or
[Docker deployment](guide/docker.md) for containers.

## What it does

Loom gives you, in a single process backed by one SQLite file, three things
that usually live in three separate tools:

- A **playground** for exercising models and MCP tool flows
- A **request log** that captures the full prompt and full response of every
  call, with search, replay, and direct SQLite access
- An **OpenAI-compatible gateway** at `/api/v1/*` for your applications, with
  the same auth model and the same log table as the playground

The same auth applies across playground and gateway. The same MCP servers
serve both. The same log table records both. There is no separate
observability service to deploy.

## Documentation map

- [Getting started](guide/getting-started.md) — install, init, first request
- [Docker deployment](guide/docker.md) — image tags, volumes, secrets, backups
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

Loom is under active development. The public surface (HTTP API, CLI flags,
config file shape) is stabilising but may still change before `1.0`. Pin a
specific version in production until `1.0.0` ships.

## License

[MIT](https://github.com/HSPK/loom/blob/main/LICENSE) — © HSPK and contributors.
