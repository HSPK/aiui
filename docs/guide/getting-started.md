# Getting started

Loom ships as a single Node CLI distributed via GitHub Releases (no npm registry),
and as a container image on the GitHub Container Registry. Either way it runs as
a single process backed by SQLite.

## Requirements

- **Node.js ≥ 20** — or just Docker, which bundles everything
- A modern OS that can build / run `better-sqlite3` (Linux, macOS, Windows)
- An API key from at least one upstream LLM provider

## Install

Loom runs as a single Node process backed by SQLite, or as a container.

=== "Install script"

    Linux and macOS. Detects `bun` or `npm`, verifies your Node version, and
    installs the latest release:

    ```bash
    curl -fsSL https://raw.githubusercontent.com/HSPK/loom/main/install.sh | sh
    ```

    Options go after `-s --`:

    ```bash
    # Pin a version
    curl -fsSL .../install.sh | sh -s -- --version 1.4.8
    # Force a package manager
    curl -fsSL .../install.sh | sh -s -- --package-manager npm
    # Remove it again
    curl -fsSL .../install.sh | sh -s -- --uninstall
    ```

=== "Docker"

    No Node install, no config — a master key and admin password are
    generated into the volume on first start:

    ```bash
    docker run -d --name loom -p 3000:3000 -v loom-data:/data \
      ghcr.io/hspk/loom:latest
    docker logs loom      # first-run admin password
    ```

    See [Docker deployment](docker.md) for volumes, secrets, backups, and
    reverse proxies.

=== "Docker Compose"

    ```bash
    curl -fsSLO https://raw.githubusercontent.com/HSPK/loom/main/docker-compose.yml
    docker compose up -d
    docker compose logs -f loom
    ```

=== "Tarball"

    Pre-built tarballs are attached to every GitHub Release. Re-run the same
    command to upgrade.

    ```bash
    # Latest
    bun add -g https://github.com/HSPK/loom/releases/latest/download/loom.tgz
    # Pinned
    bun add -g https://github.com/HSPK/loom/releases/download/v1.4.8/loom-1.4.8.tgz
    # With npm
    npm i -g https://github.com/HSPK/loom/releases/latest/download/loom.tgz
    ```

All the CLI routes add the `loom` binary to your `$PATH`. No lifecycle scripts
run on tarball install — Loom recreates its install-time symlinks at CLI
startup, so the package works identically on bun, npm, pnpm, and yarn without
any trust prompts or `--allow-scripts` flags.

!!! tip "Docker users can skip ahead"

    The container runs `loom start` for you and bootstraps its own config.
    Jump straight to [Your first request](#your-first-request).

## Initialize

Run the interactive wizard:

```bash
loom init
```

It collects:

1. Where the config file should live — project dir, user home, or a custom path
2. Admin username + password (or a reference to `${LOOM_ADMIN_PASSWORD}`)
3. Your first provider (OpenAI / Azure OpenAI / Azure AI Foundry / skip)
4. Port + hostname
5. Whether to start the server immediately

A `loom.config.yaml` is written with `chmod 600` and a freshly generated `master_key`.

### Non-interactive variants

```bash
# Write a default template
loom init --yes --force

# Print the template to stdout
loom init --print > loom.config.yaml
```

## Start

```bash
loom start              # production server
loom start -p 4000      # custom port
loom dev                # hot-reloading dev mode
```

The default URL is <http://localhost:3000>. Log in with the admin credentials you set during init.

## Your first request

1. Visit `/settings/api-keys` and create a key (`sk-loom-...`)
2. Make sure at least one provider has a valid `api_key`

```bash
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
print(client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "Hello"}],
).choices[0].message.content)
```

## Next steps

- Deploy with containers, volumes, and a reverse proxy — see [Docker](docker.md)
- Add more providers and tweak per-model defaults — see [Providers](providers.md)
- Wire in MCP tools — see [MCP integration](mcp.md)
- Explore the playground — see [Playground](playground.md)
- Use the request log for forensics — see [Request logs](logs.md)
