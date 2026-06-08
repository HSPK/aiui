# CLI reference

Loom ships one binary: `loom`. Subcommands are wired via `citty`.

## `loom init`

Interactive setup wizard. Generates a `loom.config.yaml` with a freshly minted `master_key`.

```text
USAGE loom init [OPTIONS]

OPTIONS
  --out=<path>   Write to a custom path instead of ./loom.config.yaml
  --user         Write to ~/.config/loom.yaml (shortcut)
  --force        Overwrite an existing file without prompting
  -y, --yes      Skip the wizard — write a default template (CI-friendly)
  --print        Print the template to stdout instead of writing a file
```

The wizard collects:

1. Where the config file should live
2. Admin username + password (or env var reference)
3. Your first provider (OpenAI / Azure OpenAI / Azure AI Foundry / skip)
4. Port + hostname
5. Whether to start the server immediately

## `loom start`

Run the production server. Equivalent to `next start` plus a config preflight that hoists `loom.config.yaml` values into the environment.

```text
USAGE loom start [OPTIONS]

OPTIONS
  -p, --port=<port>          Port to listen on (default 3000)
  -H, --hostname=<hostname>  Hostname (default 0.0.0.0)
```

## `loom dev`

Hot-reloading development server. Same flag surface as `start`.

```text
USAGE loom dev [OPTIONS]

OPTIONS
  -p, --port=<port>          Port to listen on (default 3000)
  -H, --hostname=<hostname>  Hostname (default 0.0.0.0)
```

## Default subcommand

Running `loom` with no subcommand defaults to `start`, so:

```bash
loom -p 4000      # equivalent to: loom start -p 4000
```
