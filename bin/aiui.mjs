#!/usr/bin/env node
// AIUI CLI — thin wrapper around the Next.js gateway that bundles helpers
// like `init-config` and ergonomic `start`/`dev` commands.

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

function buildConfigTemplate({ masterKey }) {
    return `# AIUI gateway configuration
# -----------------------------------------------------------------------------
# Loaded once at server boot. Entries are upserted into the SQLite DB by
# \`name\` — extras already in the DB are left alone, so UI-managed and
# file-managed configuration coexist.
#
# Strings support \${ENV_VAR} interpolation, e.g. \`api_key: \${OPENAI_API_KEY}\`.
# Any field can be edited through the admin UI later.
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
# * If you prefer secret injection, leave master_key out and set the
#   AIUI_MASTER_KEY environment variable instead. The env var wins if both
#   are set.

master_key: ${JSON.stringify(masterKey)}

# Admin bootstrap: created on first boot if the users table is empty.
# (You can also set AIUI_ADMIN_USERNAME / AIUI_ADMIN_PASSWORD env vars.)
# admin:
#   username: admin
#   password: change-me

providers:
  # OpenAI-compatible upstream — works for OpenAI, DeepSeek, Together, Groq,
  # vLLM, Ollama, any service that speaks /chat/completions.
  - name: openai
    type: openai
    base_url: https://api.openai.com/v1
    api_key: \${OPENAI_API_KEY}
    document_page: https://platform.openai.com/docs

  # Azure OpenAI — note the URL shape and that models below must point at
  # deployment names, not raw model names.
  # - name: azure-eastus
  #   type: azure
  #   base_url: https://my-resource.openai.azure.com
  #   api_version: "2024-10-21"
  #   api_key: \${AZURE_OPENAI_API_KEY}

models:
  - name: gpt-4o-mini
    provider: openai
    upstream_model_id: gpt-4o-mini
    type: chat
    context_window: 128000
    max_tokens: 16384

  - name: text-embedding-3-small
    provider: openai
    upstream_model_id: text-embedding-3-small
    type: embedding
    output_dimension: 1536

  # Azure example — \`upstream_model_id\` is the deployment name in your
  # Azure resource, NOT the underlying model name.
  # - name: azure-gpt-4o
  #   provider: azure-eastus
  #   upstream_model_id: my-gpt-4o-deployment
  #   type: chat
  #   context_window: 128000
`;
}

function generateMasterKey() {
    // 32 random bytes, hex-encoded — fits in env vars/yaml strings comfortably
    return randomBytes(32).toString("hex");
}

function parseArgs(argv) {
    const flags = {};
    const positional = [];
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

function runNext(mode, flags) {
    if (!existsSync(NEXT_BIN)) {
        console.error(`Couldn't find Next.js at ${NEXT_BIN}.`);
        console.error("If you're running from source, make sure \`bun install\` succeeded.");
        process.exit(1);
    }
    const args = [mode];
    if (flags.port || flags.p) args.push("-p", String(flags.port || flags.p));
    if (flags.hostname || flags.H) args.push("-H", String(flags.hostname || flags.H));
    const child = spawn(NEXT_BIN, args, {
        cwd: PACKAGE_ROOT,
        env: {
            ...process.env,
            // Make sure server-side code resolves config + DB against the
            // directory the user invoked us from, not the package dir.
            AIUI_USER_CWD: USER_CWD,
        },
        stdio: "inherit",
    });
    child.on("exit", (code) => process.exit(code ?? 0));
}

function cmdInitConfig(flags) {
    const masterKey = generateMasterKey();
    const yaml = buildConfigTemplate({ masterKey });

    if (flags.print) {
        process.stdout.write(yaml);
        return;
    }

    let outPath;
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
    console.log("  • Run \`aiui start\` (or \`aiui dev\`).");
    if (outPath.includes("aiui.config.yaml") || outPath.includes("aiui.yaml")) {
        console.log("  • This file contains the master_key — keep it out of version control.");
    }
}

function main() {
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
