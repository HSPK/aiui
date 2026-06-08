# Configuration

`loom.config.yaml` is the single source of truth for everything you can configure on the gateway. JSON and YML are also accepted.

## Search order

The CLI looks in this order, first match wins:

1. `$LOOM_CONFIG_PATH` (resolved against your current working directory)
2. `./loom.config.yaml`, `./loom.config.yml`, `./loom.config.json`
3. `./.config/loom.yaml`, `./.config/loom.yml`, `./.config/loom.json`
4. `$XDG_CONFIG_HOME/loom.{yaml,yml,json}` (defaults to `~/.config/loom.*`)

## Schema

```yaml
# ---- Secrets -----------------------------------------------------------
master_key: <32-byte hex>     # AES-256-GCM key for stored provider keys

# ---- Storage -----------------------------------------------------------
database:
  path: ./data/loom.db        # default: <cwd>/data/loom.db

# ---- Server ------------------------------------------------------------
server:
  port: 3000
  hostname: 0.0.0.0

# ---- Admin bootstrap ---------------------------------------------------
# Created on first boot if the users table is empty.
admin:
  username: admin
  password: ${LOOM_ADMIN_PASSWORD}

# ---- Session -----------------------------------------------------------
session:
  ttl_days: 30

# ---- Caching -----------------------------------------------------------
cache:
  models_ttl_seconds: 300     # provider /models discovery cache TTL

# ---- Providers ---------------------------------------------------------
providers:
  - name: openai
    base_url: https://api.openai.com/v1
    api_key: ${OPENAI_API_KEY}
```

## Environment-variable interpolation

Every string field supports `${ENV_VAR}` interpolation. Variables that aren't set resolve to an empty string.

## Precedence

For every config field there's a matching env var. **Env vars that are already set always win over the file** — this lets containerized deployments override anything without modifying the mounted config:

| Config field                   | Env var                  |
| ------------------------------ | ------------------------ |
| `master_key`                   | `LOOM_MASTER_KEY`        |
| `database.path`                | `LOOM_DB_PATH`           |
| `server.port`                  | `LOOM_SERVER_PORT`       |
| `server.hostname`              | `LOOM_SERVER_HOSTNAME`   |
| `admin.username`               | `LOOM_ADMIN_USERNAME`    |
| `admin.password`               | `LOOM_ADMIN_PASSWORD`    |
| `session.ttl_days`             | `LOOM_SESSION_TTL_DAYS`  |
| `cache.models_ttl_seconds`     | `LOOM_MODELS_CACHE_TTL`  |

CLI flags (`-p`, `-H`) win over both.

See the full list of env vars in the [reference](../reference/env-vars.md).

## Security

- **Never commit `loom.config.yaml`** — it contains `master_key`, which decrypts every stored provider API key. The CLI writes it with `chmod 600` for a reason.
- The included `.gitignore` already excludes `loom.config.{yaml,yml,json}`.
- Rotating `master_key` makes existing encrypted provider keys unreadable. To rotate, re-enter every provider key after changing the master.

## Provider catalog

The `providers:` block in the config seeds your initial set on first boot. After that, the admin UI is the source of truth — additions / edits / deletes don't require restarting.

Models are **not** in the config. Loom discovers them live from each provider's `/models` endpoint and caches the result. Use the admin UI's Models tab to register display-name aliases, deployment IDs, or per-model default parameters.
