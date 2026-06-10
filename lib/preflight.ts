// Loom config preflight — pure TS, no DB or framework dependencies, so it
// can be imported by both the CLI (bin/loom.ts) and the Next server
// (lib/server/config.ts).
//
// Locates the YAML/JSON config file, parses it, and hoists "infrastructure"
// fields into environment variables so the rest of the codebase only has to
// look at process.env. Env vars that are already set are NEVER overridden —
// deployments injecting secrets via env keep working without surprise.
//
// Search order (first match wins):
//   1. $LOOM_CONFIG_PATH (resolved against userCwd)
//   2. {userCwd}/loom.config.{yaml,yml,json}
//   3. {userCwd}/.config/loom.{yaml,yml,json}
//   4. $XDG_CONFIG_HOME (or ~/.config)/loom.{yaml,yml,json}
//
// `userCwd` = process.env.LOOM_USER_CWD || process.cwd().

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import type { LoomConfig } from "@/lib/schemas/config";

const DEFAULT_FILENAMES = ["loom.config.yaml", "loom.config.yml", "loom.config.json"];
const DOT_CONFIG_FILENAMES = ["loom.yaml", "loom.yml", "loom.json"];

export function userCwd(): string {
    return process.env.LOOM_USER_CWD || process.cwd();
}

export function xdgConfigHome(): string {
    return process.env.XDG_CONFIG_HOME || resolve(homedir(), ".config");
}

export function locateConfigFile(): string | null {
    const explicit = process.env.LOOM_CONFIG_PATH;
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

/** Recursively replace ${ENV_VAR} in any string value with the corresponding
 *  env var. When a referenced env var is unset/empty, the ENTIRE string is
 *  returned as `undefined` (and a one-shot warning is emitted) — partial
 *  interpolation silently produces empty strings, which would defeat the
 *  "only overwrite if specified" guards in upsertProvider et al. (a leaked
 *  `${OPENAI_KEY}` with the env unset would otherwise wipe the stored secret
 *  on every config reload). Returning undefined lets the existing `!==
 *  undefined` checks correctly treat the field as "not specified in this
 *  config", preserving the UI-managed value. */
const warnedUnsetEnvVars = new Set<string>();
export function interpolateEnv<T>(value: T): T {
    if (typeof value === "string") {
        let hasUnset = false;
        value.replace(/\$\{([A-Z0-9_]+)\}/g, (_m, name) => {
            const v = process.env[name];
            if (v === undefined || v === "") {
                hasUnset = true;
                if (!warnedUnsetEnvVars.has(name)) {
                    warnedUnsetEnvVars.add(name);
                    console.warn(
                        `[loom:config] env var \${${name}} is not set — fields referencing it will be treated as omitted (preserving any existing DB value)`,
                    );
                }
            }
            return "";
        });
        if (hasUnset) return undefined as unknown as T;
        return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_m, name) => process.env[name] ?? "") as T;
    }
    if (Array.isArray(value)) {
        return value.map((v) => interpolateEnv(v)) as unknown as T;
    }
    if (value && typeof value === "object") {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            const interpolated = interpolateEnv(v);
            // Drop the key entirely when interpolation collapsed to undefined
            // so the "field not specified" guards in downstream consumers
            // (entry.api_key !== undefined etc.) re-engage and the existing
            // DB-stored value is preserved.
            if (interpolated !== undefined) out[k] = interpolated;
        }
        return out as T;
    }
    return value;
}

export function parseConfigFile(path: string): LoomConfig {
    const text = readFileSync(path, "utf8");
    const raw = path.endsWith(".json") ? JSON.parse(text) : parseYaml(text);
    return interpolateEnv((raw ?? {}) as LoomConfig);
}

function setEnvIfMissing(name: string, value: unknown): void {
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
 *   master_key                  -> LOOM_MASTER_KEY
 *   database.path               -> LOOM_DB_PATH
 *   admin.username              -> LOOM_ADMIN_USERNAME
 *   admin.password              -> LOOM_ADMIN_PASSWORD
 *   session.ttl_days            -> LOOM_SESSION_TTL_DAYS
 *   cache.models_ttl_seconds    -> LOOM_MODELS_CACHE_TTL
 *   server.port                 -> LOOM_SERVER_PORT     (CLI uses this)
 *   server.hostname             -> LOOM_SERVER_HOSTNAME (CLI uses this)
 *   server.trust_proxy          -> LOOM_TRUST_PROXY     (=1 when true)
 */
export function applyConfigEnv(cfg: LoomConfig | null | undefined): string[] {
    if (!cfg || typeof cfg !== "object") return [];
    const applied: string[] = [];
    const map = (envName: string, value: unknown) => {
        const before = process.env[envName];
        setEnvIfMissing(envName, value);
        if (process.env[envName] !== before) applied.push(envName);
    };
    map("LOOM_MASTER_KEY", cfg.master_key);
    map("LOOM_DB_PATH", cfg.database?.path);
    map("LOOM_ADMIN_USERNAME", cfg.admin?.username);
    map("LOOM_ADMIN_PASSWORD", cfg.admin?.password);
    map("LOOM_SESSION_TTL_DAYS", cfg.session?.ttl_days);
    map("LOOM_MODELS_CACHE_TTL", cfg.cache?.models_ttl_seconds);
    map("LOOM_SERVER_PORT", cfg.server?.port);
    map("LOOM_SERVER_HOSTNAME", cfg.server?.hostname);
    map("LOOM_TRUST_PROXY", cfg.server?.trust_proxy ? "1" : undefined);
    return applied;
}

export interface PreflightResult {
    path: string | null;
    cfg: LoomConfig | null;
    applied: string[];
}

/**
 * One-shot: locate, parse, apply env vars, return the parsed config (or null).
 */
export function preflightFromConfig(): PreflightResult {
    const path = locateConfigFile();
    if (!path) return { path: null, cfg: null, applied: [] };
    let cfg: LoomConfig;
    try {
        cfg = parseConfigFile(path);
    } catch (err) {
        console.error(`[loom:config] failed to parse ${path}:`, err);
        return { path, cfg: null, applied: [] };
    }
    const applied = applyConfigEnv(cfg);
    return { path, cfg, applied };
}
