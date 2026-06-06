// AIUI config preflight — pure JS, no DB or framework dependencies, so it
// can be imported by both the CLI (bin/aiui.mjs) and the Next server.
//
// Locates the YAML/JSON config file, parses it, and hoists "infrastructure"
// fields into environment variables so the rest of the codebase only has to
// look at process.env. Env vars that are already set are NEVER overridden —
// deployments injecting secrets via env keep working without surprise.
//
// Search order (first match wins):
//   1. $AIUI_CONFIG_PATH (resolved against userCwd)
//   2. {userCwd}/aiui.config.{yaml,yml,json}
//   3. {userCwd}/.config/aiui.{yaml,yml,json}
//   4. $XDG_CONFIG_HOME (or ~/.config)/aiui.{yaml,yml,json}
//
// `userCwd` = process.env.AIUI_USER_CWD || process.cwd().

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";

const DEFAULT_FILENAMES = ["aiui.config.yaml", "aiui.config.yml", "aiui.config.json"];
const DOT_CONFIG_FILENAMES = ["aiui.yaml", "aiui.yml", "aiui.json"];

export function userCwd() {
    return process.env.AIUI_USER_CWD || process.cwd();
}

export function xdgConfigHome() {
    return process.env.XDG_CONFIG_HOME || resolve(homedir(), ".config");
}

export function locateConfigFile() {
    const explicit = process.env.AIUI_CONFIG_PATH;
    if (explicit) {
        const p = resolve(userCwd(), explicit);
        return existsSync(p) ? p : null;
    }
    const cwd = userCwd();
    const candidates = [
        ...DEFAULT_FILENAMES.map((f) => resolve(cwd, f)),
        ...DOT_CONFIG_FILENAMES.map((f) => resolve(cwd, ".config", f)),
        ...DOT_CONFIG_FILENAMES.map((f) => resolve(xdgConfigHome(), f)),
    ];
    for (const p of candidates) {
        if (existsSync(p)) return p;
    }
    return null;
}

/** Recursively replace ${ENV_VAR} in any string value with the corresponding env var. */
export function interpolateEnv(value) {
    if (typeof value === "string") {
        return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_m, name) => process.env[name] ?? "");
    }
    if (Array.isArray(value)) return value.map(interpolateEnv);
    if (value && typeof value === "object") {
        const out = {};
        for (const [k, v] of Object.entries(value)) out[k] = interpolateEnv(v);
        return out;
    }
    return value;
}

export function parseConfigFile(path) {
    const text = readFileSync(path, "utf8");
    const raw = path.endsWith(".json") ? JSON.parse(text) : parseYaml(text);
    return interpolateEnv(raw ?? {});
}

function setEnvIfMissing(name, value) {
    if (value === undefined || value === null) return;
    if (process.env[name] !== undefined && process.env[name] !== "") return;
    const str = typeof value === "string" ? value : String(value);
    if (!str) return;
    process.env[name] = str;
}

/**
 * Apply the "infrastructure" fields of a parsed config object as environment
 * variables. Returns the list of env vars that were set (useful for logging).
 *
 * Mapping:
 *   master_key                  -> AIUI_MASTER_KEY
 *   database.path               -> AIUI_DB_PATH
 *   admin.username              -> AIUI_ADMIN_USERNAME
 *   admin.password              -> AIUI_ADMIN_PASSWORD
 *   session.ttl_days            -> AIUI_SESSION_TTL_DAYS
 *   cache.models_ttl_seconds    -> AIUI_MODELS_CACHE_TTL
 *   server.port                 -> AIUI_SERVER_PORT     (CLI uses this)
 *   server.hostname             -> AIUI_SERVER_HOSTNAME (CLI uses this)
 */
export function applyConfigEnv(cfg) {
    if (!cfg || typeof cfg !== "object") return [];
    const applied = [];
    const map = (envName, value) => {
        const before = process.env[envName];
        setEnvIfMissing(envName, value);
        if (process.env[envName] !== before) applied.push(envName);
    };
    map("AIUI_MASTER_KEY", cfg.master_key);
    map("AIUI_DB_PATH", cfg?.database?.path);
    map("AIUI_ADMIN_USERNAME", cfg?.admin?.username);
    map("AIUI_ADMIN_PASSWORD", cfg?.admin?.password);
    map("AIUI_SESSION_TTL_DAYS", cfg?.session?.ttl_days);
    map("AIUI_MODELS_CACHE_TTL", cfg?.cache?.models_ttl_seconds);
    map("AIUI_SERVER_PORT", cfg?.server?.port);
    map("AIUI_SERVER_HOSTNAME", cfg?.server?.hostname);
    return applied;
}

/**
 * One-shot: locate, parse, apply env vars, return the parsed config (or null).
 */
export function preflightFromConfig() {
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
