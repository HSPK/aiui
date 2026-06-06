#!/usr/bin/env node

// bin/aiui.ts
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync as existsSync2, mkdirSync, writeFileSync } from "node:fs";
import { homedir as homedir2 } from "node:os";
import { dirname, resolve as resolve2 } from "node:path";
import { fileURLToPath } from "node:url";

// lib/preflight.ts
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
var DEFAULT_FILENAMES = ["aiui.config.yaml", "aiui.config.yml", "aiui.config.json"];
var DOT_CONFIG_FILENAMES = ["aiui.yaml", "aiui.yml", "aiui.json"];
function userCwd() {
  return process.env.AIUI_USER_CWD || process.cwd();
}
function xdgConfigHome() {
  return process.env.XDG_CONFIG_HOME || resolve(homedir(), ".config");
}
function locateConfigFile() {
  const explicit = process.env.AIUI_CONFIG_PATH;
  if (explicit) {
    const p = resolve(userCwd(), explicit);
    return existsSync(p) ? p : null;
  }
  const cwd = userCwd();
  const candidates = [
    ...DEFAULT_FILENAMES.map((f) => resolve(cwd, f)),
    ...DOT_CONFIG_FILENAMES.map((f) => resolve(cwd, ".config", f)),
    ...DOT_CONFIG_FILENAMES.map((f) => resolve(xdgConfigHome(), f))
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}
function interpolateEnv(value) {
  if (typeof value === "string") {
    return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_m, name) => process.env[name] ?? "");
  }
  if (Array.isArray(value)) {
    return value.map((v) => interpolateEnv(v));
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = interpolateEnv(v);
    }
    return out;
  }
  return value;
}
function parseConfigFile(path) {
  const text = readFileSync(path, "utf8");
  const raw = path.endsWith(".json") ? JSON.parse(text) : parseYaml(text);
  return interpolateEnv(raw ?? {});
}
function setEnvIfMissing(name, value) {
  if (value === void 0 || value === null) return;
  if (process.env[name] !== void 0 && process.env[name] !== "") return;
  const str = typeof value === "string" ? value : String(value);
  if (!str) return;
  process.env[name] = str;
}
function applyConfigEnv(cfg) {
  if (!cfg || typeof cfg !== "object") return [];
  const applied = [];
  const map = (envName, value) => {
    const before = process.env[envName];
    setEnvIfMissing(envName, value);
    if (process.env[envName] !== before) applied.push(envName);
  };
  map("AIUI_MASTER_KEY", cfg.master_key);
  map("AIUI_DB_PATH", cfg.database?.path);
  map("AIUI_ADMIN_USERNAME", cfg.admin?.username);
  map("AIUI_ADMIN_PASSWORD", cfg.admin?.password);
  map("AIUI_SESSION_TTL_DAYS", cfg.session?.ttl_days);
  map("AIUI_MODELS_CACHE_TTL", cfg.cache?.models_ttl_seconds);
  map("AIUI_SERVER_PORT", cfg.server?.port);
  map("AIUI_SERVER_HOSTNAME", cfg.server?.hostname);
  return applied;
}
function preflightFromConfig() {
  const path = locateConfigFile();
  if (!path) return { path: null, cfg: null, applied: [] };
  let cfg;
  try {
    cfg = parseConfigFile(path);
  } catch (err) {
    console.error(`[aiui:config] failed to parse ${path}:`, err);
    return { path, cfg: null, applied: [] };
  }
  const applied = applyConfigEnv(cfg);
  return { path, cfg, applied };
}

// bin/aiui.ts
var HERE = dirname(fileURLToPath(import.meta.url));
var PACKAGE_ROOT = resolve2(HERE, "..");
var NEXT_BIN = resolve2(PACKAGE_ROOT, "node_modules", ".bin", "next");
var USER_CWD = process.cwd();
var HELP = `aiui \u2014 industrial-grade AI gateway

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
  1. $AIUI_CONFIG_PATH
  2. ./aiui.config.{yaml,yml,json}
  3. ./.config/aiui.{yaml,yml,json}
  4. $XDG_CONFIG_HOME/aiui.{yaml,yml,json} (or ~/.config/aiui.{yaml,yml,json})

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
# This file is the single source of truth for everything you can configure on
# the gateway. Anything you set here is hoisted into the corresponding env var
# at startup, but env vars that are ALREADY set take precedence \u2014 so production
# deployments can still override individual fields via secret injection.
#
# Strings support \${ENV_VAR} interpolation, e.g. \`api_key: \${OPENAI_API_KEY}\`.
#
# Search order (first match wins):
#   1. $AIUI_CONFIG_PATH
#   2. ./aiui.config.{yaml,yml,json}
#   3. ./.config/aiui.{yaml,yml,json}
#   4. $XDG_CONFIG_HOME/aiui.{yaml,yml,json}    (or ~/.config/...)
#
# IMPORTANT:
# * The master_key below decrypts every stored Provider API key. KEEP IT SECRET
#   \u2014 do not commit this file. Rotating the key makes existing encrypted keys
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
# Models are NOT configured here \u2014 they are discovered live from each
# provider's /models endpoint. Use the admin UI to register per-model
# overrides (Azure deployment names, display-name aliases, context-window
# pinning).
providers:
  # OpenAI-compatible \u2014 works for OpenAI, DeepSeek, Together, Groq, vLLM,
  # Ollama, any service that speaks /chat/completions.
  - name: openai
    type: openai
    base_url: https://api.openai.com/v1
    api_key: \${OPENAI_API_KEY}
    document_page: https://platform.openai.com/docs

  # Azure OpenAI \u2014 note that the /models catalog endpoint returns base
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
function generateMasterKey() {
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
      if (next !== void 0 && !next.startsWith("-")) {
        flags[name] = next;
        i++;
      } else {
        flags[name] = true;
      }
    } else if (a.startsWith("-") && a.length > 1) {
      const name = a.slice(1);
      const next = argv[i + 1];
      if (next !== void 0 && !next.startsWith("-")) {
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
  if (!existsSync2(NEXT_BIN)) {
    console.error(`Couldn't find Next.js at ${NEXT_BIN}.`);
    console.error("If you're running from source, make sure `bun install` succeeded.");
    process.exit(1);
  }
  process.env.AIUI_USER_CWD = USER_CWD;
  const { path: cfgPath, applied } = preflightFromConfig();
  if (cfgPath) {
    const note = applied.length > 0 ? ` (env: ${applied.join(", ")})` : "";
    console.log(`[aiui] loaded config from ${cfgPath}${note}`);
  }
  const args = [mode];
  const port = flags.port || flags.p || process.env.AIUI_SERVER_PORT || process.env.PORT;
  const host = flags.hostname || flags.H || process.env.AIUI_SERVER_HOSTNAME;
  if (port) args.push("-p", String(port));
  if (host) args.push("-H", String(host));
  const child = spawn(NEXT_BIN, args, {
    cwd: PACKAGE_ROOT,
    env: process.env,
    stdio: "inherit"
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
    outPath = resolve2(USER_CWD, String(flags.out));
  } else if (flags.user) {
    const xdg = process.env.XDG_CONFIG_HOME || resolve2(homedir2(), ".config");
    outPath = resolve2(xdg, "aiui.yaml");
  } else {
    outPath = resolve2(USER_CWD, "aiui.config.yaml");
  }
  if (existsSync2(outPath) && !flags.force) {
    console.error(`Refusing to overwrite existing file: ${outPath}`);
    console.error("Pass --force to replace it, or --print to write to stdout.");
    process.exit(1);
  }
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, yaml, { mode: 384 });
  console.log(`Wrote ${outPath}`);
  console.log("");
  console.log("Next steps:");
  console.log("  \u2022 Edit the file and set OPENAI_API_KEY (or other) in your env.");
  console.log("  \u2022 Run `aiui start` (or `aiui dev`).");
  if (outPath.includes("aiui.config.yaml") || outPath.includes("aiui.yaml")) {
    console.log("  \u2022 This file contains the master_key \u2014 keep it out of version control.");
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
      console.error(`Unknown command: ${cmd}
`);
      process.stdout.write(HELP);
      process.exit(2);
  }
}
main();
