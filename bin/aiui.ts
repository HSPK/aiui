#!/usr/bin/env node
// AIUI CLI — thin wrapper around the Next.js gateway that bundles helpers
// like `init-config` and ergonomic `start`/`dev` commands.
//
// SOURCE in TypeScript: scripts/build-cli.mjs bundles this file (with the
// transitive lib/preflight.ts) into bin/aiui.js via esbuild. The compiled
// file gets the same `#!/usr/bin/env node` shebang via the esbuild banner.

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { preflightFromConfig } from "../lib/preflight";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(HERE, "..");
const NEXT_BIN = resolve(PACKAGE_ROOT, "node_modules", ".bin", "next");
const USER_CWD = process.cwd();

const HELP = `aiui — industrial-grade AI gateway

Usage:
  aiui [command] [options]

Commands:
  start                     Run the production server (next start)
  dev                       Run the development server (next dev)
  init-config [options]     Write a starter aiui.config.yaml with a generated master_key
  help                      Show this help

start / dev options:
  -p, --port <port>         Port to listen on (default 3000)
  -H, --hostname <host>     Hostname (default 0.0.0.0)

init-config options:
      --out <path>          Write to <path> instead of ./aiui.config.yaml
      --print               Write to stdout instead of a file
      --force               Overwrite an existing file
      --user                Write to ~/.config/aiui.yaml (shortcut)

Config search order (first match wins):
  1. \$AIUI_CONFIG_PATH
  2. ./aiui.config.{yaml,yml,json}
  3. ./.config/aiui.{yaml,yml,json}
  4. \$XDG_CONFIG_HOME/aiui.{yaml,yml,json} (or ~/.config/aiui.{yaml,yml,json})

Environment variables (override config-file fields):
  AIUI_MASTER_KEY           AES-GCM key for upstream Provider api keys
  AIUI_DB_PATH              SQLite path (default ./data/aiui.db)
  AIUI_CONFIG_PATH          Explicit config file path
  AIUI_ADMIN_USERNAME       First-boot admin username
  AIUI_ADMIN_PASSWORD       First-boot admin password
`;

interface ConfigTemplateOptions {
    masterKey: string;
}

function buildConfigTemplate({ masterKey }: ConfigTemplateOptions): string {
    return `# AIUI gateway configuration
# -----------------------------------------------------------------------------
# This file is the single source of truth for everything you can configure on
# the gateway. Anything you set here is hoisted into the corresponding env var
# at startup, but env vars that are ALREADY set take precedence — so production
# deployments can still override individual fields via secret injection.
#
# Strings support \${ENV_VAR} interpolation, e.g. \`api_key: \${OPENAI_API_KEY}\`.
#
# Search order (first match wins):
#   1. \$AIUI_CONFIG_PATH
#   2. ./aiui.config.{yaml,yml,json}
#   3. ./.config/aiui.{yaml,yml,json}
#   4. \$XDG_CONFIG_HOME/aiui.{yaml,yml,json}    (or ~/.config/...)
#
# IMPORTANT:
# * The master_key below decrypts every stored Provider API key. KEEP IT SECRET
#   — do not commit this file. Rotating the key makes existing encrypted keys
#   unreadable.

# ---- Secrets -------------------------------------------------------------
master_key: ${JSON.stringify(masterKey)}

# ---- Storage -------------------------------------------------------------
# SQLite database location. Relative paths resolve against your current
# working directory (the dir you invoked \`aiui\` from). Default:
#   <cwd>/data/aiui.db
# NOTE: this field only takes effect via the \`aiui\` CLI. If you bypass the
# CLI (e.g. \`bun run start\`), set AIUI_DB_PATH explicitly.
# database:
#   path: ./data/aiui.db

# ---- Server --------------------------------------------------------------
# Override the listen address. CLI flags (-p / -H) still win.
# server:
#   port: 3000
#   hostname: 0.0.0.0

# ---- Admin bootstrap -----------------------------------------------------
# Created on first boot if the users table is empty. Without these the
# gateway starts but you'll have no way to log in.
admin:
  username: admin
  password: \${AIUI_ADMIN_PASSWORD}

# ---- Session ------------------------------------------------------------
# How long an authenticated browser session lasts. Default: 30 days.
# session:
#   ttl_days: 30

# ---- Caching -----------------------------------------------------------
# Per-provider /models discovery cache TTL. Set to 0 to disable caching.
# cache:
#   models_ttl_seconds: 300

# ---- Providers ----------------------------------------------------------
# Models are NOT configured here — they are discovered live from each
# provider's /models endpoint. Use the admin UI to register per-model
# overrides (Azure deployment names, display-name aliases, context-window
# pinning).
providers:
  # OpenAI-compatible — works for OpenAI, DeepSeek, Together, Groq, vLLM,
  # Ollama, any service that speaks /chat/completions.
  - name: openai
    type: openai
    base_url: https://api.openai.com/v1
    api_key: \${OPENAI_API_KEY}
    document_page: https://platform.openai.com/docs

  # Azure OpenAI — note that the /models catalog endpoint returns base
  # model names, NOT deployment names. To call your deployments through the
  # gateway, register each deployment as a row in the admin UI's Models
  # tab, mapping a display name (e.g. \`my-gpt-4o\`) to its deployment id.
  # - name: azure-eastus
  #   type: azure
  #   base_url: https://my-resource.openai.azure.com
  #   api_version: "2024-10-21"
  #   api_key: \${AZURE_OPENAI_API_KEY}
`;
}

function generateMasterKey(): string {
    // 32 random bytes, hex-encoded — fits in env vars/yaml strings comfortably
    return randomBytes(32).toString("hex");
}

type Flags = Record<string, string | boolean>;

interface ParsedArgs {
    flags: Flags;
    positional: string[];
}

function parseArgs(argv: string[]): ParsedArgs {
    const flags: Flags = {};
    const positional: string[] = [];
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a.startsWith("--")) {
            const name = a.slice(2);
            const next = argv[i + 1];
            if (next !== undefined && !next.startsWith("-")) {
                flags[name] = next;
                i++;
            } else {
                flags[name] = true;
            }
        } else if (a.startsWith("-") && a.length > 1) {
            const name = a.slice(1);
            const next = argv[i + 1];
            if (next !== undefined && !next.startsWith("-")) {
                flags[name] = next;
                i++;
            } else {
                flags[name] = true;
            }
        } else {
            positional.push(a);
        }
    }
    return { flags, positional };
}

function runNext(mode: "start" | "dev", flags: Flags): void {
    if (!existsSync(NEXT_BIN)) {
        console.error(`Couldn't find Next.js at ${NEXT_BIN}.`);
        console.error("If you're running from source, make sure `bun install` succeeded.");
        process.exit(1);
    }

    // Preflight: load config file (if any) and hoist its infrastructure
    // fields into env vars BEFORE Next loads any module. This is the only
    // path that makes config-file `database.path` / `session.ttl_days` /
    // `server.port` etc. take effect.
    // Must happen first so AIUI_USER_CWD below has been considered already.
    process.env.AIUI_USER_CWD = USER_CWD;
    const { path: cfgPath, applied } = preflightFromConfig();
    if (cfgPath) {
        const note = applied.length > 0 ? ` (env: ${applied.join(", ")})` : "";
        console.log(`[aiui] loaded config from ${cfgPath}${note}`);
    }

    const args: string[] = [mode];
    const port = flags.port || flags.p || process.env.AIUI_SERVER_PORT || process.env.PORT;
    const host = flags.hostname || flags.H || process.env.AIUI_SERVER_HOSTNAME;
    if (port) args.push("-p", String(port));
    if (host) args.push("-H", String(host));

    const child = spawn(NEXT_BIN, args, {
        cwd: PACKAGE_ROOT,
        env: process.env,
        stdio: "inherit",
    });
    child.on("exit", (code) => process.exit(code ?? 0));
}

function cmdInitConfig(flags: Flags): void {
    const masterKey = generateMasterKey();
    const yaml = buildConfigTemplate({ masterKey });

    if (flags.print) {
        process.stdout.write(yaml);
        return;
    }

    let outPath: string;
    if (flags.out) {
        outPath = resolve(USER_CWD, String(flags.out));
    } else if (flags.user) {
        const xdg = process.env.XDG_CONFIG_HOME || resolve(homedir(), ".config");
        outPath = resolve(xdg, "aiui.yaml");
    } else {
        outPath = resolve(USER_CWD, "aiui.config.yaml");
    }

    if (existsSync(outPath) && !flags.force) {
        console.error(`Refusing to overwrite existing file: ${outPath}`);
        console.error("Pass --force to replace it, or --print to write to stdout.");
        process.exit(1);
    }
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, yaml, { mode: 0o600 });
    console.log(`Wrote ${outPath}`);
    console.log("");
    console.log("Next steps:");
    console.log("  • Edit the file and set OPENAI_API_KEY (or other) in your env.");
    console.log("  • Run `aiui start` (or `aiui dev`).");
    if (outPath.includes("aiui.config.yaml") || outPath.includes("aiui.yaml")) {
        console.log("  • This file contains the master_key — keep it out of version control.");
    }
}

function main(): void {
    const argv = process.argv.slice(2);
    if (argv.length === 0) {
        runNext("start", {});
        return;
    }
    const cmd = argv[0];
    const rest = argv.slice(1);
    const { flags } = parseArgs(rest);

    switch (cmd) {
        case "start":
            runNext("start", flags);
            break;
        case "dev":
            runNext("dev", flags);
            break;
        case "init-config":
        case "init":
            cmdInitConfig(flags);
            break;
        case "help":
        case "--help":
        case "-h":
            process.stdout.write(HELP);
            break;
        default:
            console.error(`Unknown command: ${cmd}\n`);
            process.stdout.write(HELP);
            process.exit(2);
    }
}

main();
