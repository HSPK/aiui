# Environment variables

Loom reads its configuration from `loom.config.yaml` and from the environment. **For every config field there is a matching env var, and env vars always win over the file.**

This makes container deployments easy: mount your config as a baseline, override secrets via env vars from your orchestrator.

## Server

| Variable                  | What it controls                                            | Default               |
| ------------------------- | ----------------------------------------------------------- | --------------------- |
| `LOOM_SERVER_PORT`        | TCP port                                                    | `3000`                |
| `LOOM_SERVER_HOSTNAME`    | Listen hostname                                             | `0.0.0.0`             |

CLI flags (`-p`, `-H`) override these.

## Storage

| Variable                  | What it controls                                            | Default               |
| ------------------------- | ----------------------------------------------------------- | --------------------- |
| `LOOM_DB_PATH`            | SQLite database file                                        | `<cwd>/data/loom.db`  |

## Secrets

| Variable                  | What it controls                                            | Default               |
| ------------------------- | ----------------------------------------------------------- | --------------------- |
| `LOOM_MASTER_KEY`         | AES-256-GCM key for stored provider / MCP secrets           | **required**          |

Rotating `LOOM_MASTER_KEY` makes existing encrypted blobs unreadable. Treat it as the root secret of your deployment.

## Admin bootstrap

Used when the `users` table is empty (first boot).

| Variable                  | What it controls                                            | Default               |
| ------------------------- | ----------------------------------------------------------- | --------------------- |
| `LOOM_ADMIN_USERNAME`     | Initial admin username                                      | `admin`               |
| `LOOM_ADMIN_PASSWORD`     | Initial admin password (required if no `admin` block in config) | —                |

## Sessions

| Variable                  | What it controls                                            | Default               |
| ------------------------- | ----------------------------------------------------------- | --------------------- |
| `LOOM_SESSION_TTL_DAYS`   | How long browser sessions stay valid                        | `30`                  |

## Caching

| Variable                  | What it controls                                            | Default               |
| ------------------------- | ----------------------------------------------------------- | --------------------- |
| `LOOM_MODELS_CACHE_TTL`   | Per-provider `/models` discovery cache, in seconds          | `300`                 |

Set to `0` to disable caching.

## Config file location

| Variable                  | What it controls                                            | Default               |
| ------------------------- | ----------------------------------------------------------- | --------------------- |
| `LOOM_CONFIG_PATH`        | Explicit path; bypasses the search order                    | —                     |
| `LOOM_USER_CWD`           | What the CLI considers "user cwd" (rarely set by hand)     | `process.cwd()`       |
| `LOOM_PACKAGE_ROOT`       | Where the installed `loom` package lives (set by CLI shim) | —                     |
| `XDG_CONFIG_HOME`         | Where to look for `loom.yaml` if not in the project        | `~/.config`           |

## Proxying

| Variable                  | What it controls                                            | Default               |
| ------------------------- | ----------------------------------------------------------- | --------------------- |
| `LOOM_TRUST_PROXY`        | Trust `X-Forwarded-For` when identifying clients. Set to `1` behind nginx / Traefik / Cloudflare, never when Loom is directly exposed | unset |

Only set this when a proxy you control rewrites the header — otherwise clients
can spoof their address and evade the login rate limiter.

## Docker

Read by the [container entrypoint](../guide/docker.md), not by the server.

| Variable                  | What it controls                                            | Default               |
| ------------------------- | ----------------------------------------------------------- | --------------------- |
| `LOOM_DATA_DIR`           | Where the entrypoint bootstraps `loom.config.yaml`          | `/data`               |

The image also presets `LOOM_DB_PATH=/data/loom.db`, `LOOM_SERVER_HOSTNAME=0.0.0.0`,
and `LOOM_SERVER_PORT=3000`. Override any of them with `-e`.
