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

## `loom update`

Check GitHub Releases for a newer version and re-install it through the package manager that owns the current install.

```text
USAGE loom update [OPTIONS]

OPTIONS
  --check          Only check for updates — don't install
  --pm=<pm>        Force a package manager (bun | npm). Default: auto-detect
  -y, --yes        Skip the install confirmation prompt
  --clean          Remove the existing global install first (clears stale entries)
```

## Default subcommand

Running `loom` with no subcommand defaults to `start`, so:

```bash
loom -p 4000      # equivalent to: loom start -p 4000
```

## Install script

`install.sh` is not part of the CLI, but it's the fastest way to get it. It
picks `bun` or `npm`, checks your Node version, and installs the release
tarball globally.

```bash
curl -fsSL https://raw.githubusercontent.com/HSPK/loom/main/install.sh | sh
```

```text
USAGE install.sh [OPTIONS]

OPTIONS
  -v, --version=<ver>           Install a specific version (1.4.8 or v1.4.8)
  -p, --package-manager=<pm>    Force "bun" or "npm"
      --uninstall               Remove a global Loom install
      --dry-run                 Print what would happen, change nothing
  -h, --help                    Show help

ENVIRONMENT
  LOOM_VERSION       Same as --version
  LOOM_INSTALL_PM    Same as --package-manager
  NO_COLOR           Disable coloured output
```

Because the script is piped into `sh`, its own options go after `-s --`:

```bash
curl -fsSL .../install.sh | sh -s -- --version 1.4.8
```

## Container

The [container image](../guide/docker.md) uses the same CLI — its entrypoint
forwards anything it doesn't recognise, so the image doubles as the binary:

```bash
docker run --rm ghcr.io/hspk/loom:latest --version
docker run --rm ghcr.io/hspk/loom:latest init --print > loom.config.yaml
docker run -d -p 3000:3000 -v loom-data:/data ghcr.io/hspk/loom:latest -p 3000
```
