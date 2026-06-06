#!/usr/bin/env node
// AIUI CLI — thin wrapper around the Next.js gateway.
//
// SOURCE in TypeScript: scripts/build-cli.mjs bundles this file (with
// transitive lib/preflight.ts + lib/schemas/config.ts) into bin/aiui.mjs
// via esbuild. The compiled file keeps the same `#!/usr/bin/env node`
// shebang (esbuild preserves it).
//
// The argument parser / subcommand router is `citty` — Click-like
// declarative descriptors that match the rest of the codebase's factory
// style (defineRoute / defineResource / registerCapability).

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineCommand, runCommand, runMain } from "citty";
import { preflightFromConfig } from "../lib/preflight";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(HERE, "..");
const NEXT_BIN = resolve(PACKAGE_ROOT, "node_modules", ".bin", "next");
const USER_CWD = process.cwd();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
    base_url: https://api.openai.com/v1
    api_key: \${OPENAI_API_KEY}
    document_page: https://platform.openai.com/docs
    # Optional dedicated health endpoint. Must return {"status":"ok"} when
    # healthy. Falls back to probing /models via the adapter when omitted.
    # health_check_url: https://status.openai.com/api/v2/status.json

  # Azure OpenAI — note that the /models catalog endpoint returns base
  # model names, NOT deployment names. To call your deployments through the
  # gateway, register each deployment as a row in the admin UI's Models
  # tab, mapping a display name (e.g. \`my-gpt-4o\`) to its deployment id.
  # - name: azure-eastus
  #   adapter_id: azure-openai
  #   base_url: https://my-resource.openai.azure.com
  #   api_version: "2024-10-21"
  #   api_key: \${AZURE_OPENAI_API_KEY}

  # Azure AI Foundry (Inference) serves OSS / partner models. The
  # \`azure-foundry\` adapter reads the rich Foundry metadata and
  # auto-strips OpenAI-only fields (stream_options, parallel_tool_calls,
  # …) that the upstream's \`extra-parameters: error\` default rejects.
  # - name: foundry
  #   adapter_id: azure-foundry
  #   base_url: https://my-foundry.services.ai.azure.com
  #   api_key: \${AZURE_FOUNDRY_API_KEY}
`;
}

function generateMasterKey(): string {
    // 32 random bytes, hex-encoded — fits in env vars/yaml strings comfortably.
    return randomBytes(32).toString("hex");
}

interface RunNextOptions {
    port?: string;
    hostname?: string;
}

function runNext(mode: "start" | "dev", opts: RunNextOptions): void {
    if (!existsSync(NEXT_BIN)) {
        console.error(`Couldn't find Next.js at ${NEXT_BIN}.`);
        console.error("If you're running from source, make sure `bun install` succeeded.");
        process.exit(1);
    }

    // Preflight: load config file (if any) and hoist its infrastructure
    // fields into env vars BEFORE Next loads any module. This is the only
    // path that makes config-file `database.path` / `session.ttl_days` /
    // `server.port` etc. take effect.
    // Set AIUI_USER_CWD first so locateConfigFile() resolves against it.
    process.env.AIUI_USER_CWD = USER_CWD;
    const { path: cfgPath, applied } = preflightFromConfig();
    if (cfgPath) {
        const note = applied.length > 0 ? ` (env: ${applied.join(", ")})` : "";
        console.log(`[aiui] loaded config from ${cfgPath}${note}`);
    }

    const args: string[] = [mode];
    const port = opts.port || process.env.AIUI_SERVER_PORT || process.env.PORT;
    const host = opts.hostname || process.env.AIUI_SERVER_HOSTNAME;
    if (port) args.push("-p", String(port));
    if (host) args.push("-H", String(host));

    const child = spawn(NEXT_BIN, args, {
        cwd: PACKAGE_ROOT,
        env: process.env,
        stdio: "inherit",
    });
    child.on("exit", (code) => process.exit(code ?? 0));
}

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

const sharedServerArgs = {
    port: {
        type: "string",
        alias: "p",
        description: "Port to listen on (default 3000)",
    },
    hostname: {
        type: "string",
        alias: "H",
        description: "Hostname (default 0.0.0.0)",
    },
} as const;

const startCommand = defineCommand({
    meta: {
        name: "start",
        description: "Run the production server (next start)",
    },
    args: sharedServerArgs,
    run({ args }) {
        runNext("start", { port: args.port, hostname: args.hostname });
    },
});

const devCommand = defineCommand({
    meta: {
        name: "dev",
        description: "Run the development server (next dev)",
    },
    args: sharedServerArgs,
    run({ args }) {
        runNext("dev", { port: args.port, hostname: args.hostname });
    },
});

const initConfigCommand = defineCommand({
    meta: {
        name: "init-config",
        description: "Write a starter aiui.config.yaml with a generated master_key",
    },
    args: {
        out: {
            type: "string",
            description: "Write to <path> instead of ./aiui.config.yaml",
        },
        print: {
            type: "boolean",
            description: "Write to stdout instead of a file",
        },
        force: {
            type: "boolean",
            description: "Overwrite an existing file",
        },
        user: {
            type: "boolean",
            description: "Write to ~/.config/aiui.yaml (shortcut)",
        },
    },
    run({ args }) {
        const yaml = buildConfigTemplate({ masterKey: generateMasterKey() });

        if (args.print) {
            process.stdout.write(yaml);
            return;
        }

        let outPath: string;
        if (args.out) {
            outPath = resolve(USER_CWD, args.out);
        } else if (args.user) {
            const xdg = process.env.XDG_CONFIG_HOME || resolve(homedir(), ".config");
            outPath = resolve(xdg, "aiui.yaml");
        } else {
            outPath = resolve(USER_CWD, "aiui.config.yaml");
        }

        if (existsSync(outPath) && !args.force) {
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
    },
});

// ---------------------------------------------------------------------------
// Root command — bare `aiui` (no subcommand) defaults to `start`
// ---------------------------------------------------------------------------

const main = defineCommand({
    meta: {
        name: "aiui",
        version: "0.1.0",
        description: "Industrial-grade AI gateway (Next.js + SQLite, OpenAI-compatible)",
    },
    subCommands: {
        start: startCommand,
        dev: devCommand,
        "init-config": initConfigCommand,
        init: initConfigCommand,
    },
    args: sharedServerArgs,
    async run({ args, rawArgs }) {
        // No subcommand provided → fall through to `start` so `aiui` and
        // `aiui -p 4000` both Just Work, matching the previous behaviour.
        await runCommand(startCommand, { rawArgs, data: args });
    },
});

runMain(main);
