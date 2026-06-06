import "server-only";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { eq } from "drizzle-orm";
import { db, schema } from "./db";
import { encryptSecret } from "./crypto";

/**
 * Local config file shape (YAML or JSON). Loaded once at server boot.
 *
 * Search order (first match wins):
 *   1. `AIUI_CONFIG_PATH` env var (explicit override)
 *   2. `{userCwd}/aiui.config.{yaml,yml,json}`
 *   3. `{userCwd}/.config/aiui.{yaml,yml,json}`
 *   4. `{XDG_CONFIG_HOME or ~/.config}/aiui.{yaml,yml,json}`
 *
 * `userCwd` is `process.env.AIUI_USER_CWD` if set (so the `aiui` CLI can pass
 * the user's working directory through when Next runs from the package dir),
 * else `process.cwd()`.
 *
 * Top-level fields:
 *   master_key    string  Optional. Hoisted into process.env.AIUI_MASTER_KEY
 *                         BEFORE any provider/model upserts so the AES-GCM
 *                         encryption can succeed without an env var. If the
 *                         env var is already set it takes precedence — that
 *                         keeps deployments that prefer secret-injection
 *                         working without surprise overrides.
 *   providers[]   Provider entries. Upserted by `name`.
 *   models[]      Model entries. Upserted by `name`.
 *
 * Behaviour: declarative-but-additive. Entries not in the file are left
 * untouched in the DB, so UI-managed and file-managed config coexist.
 * Strings support `${ENV_VAR}` interpolation.
 */

const DEFAULT_FILENAMES = ["aiui.config.yaml", "aiui.config.yml", "aiui.config.json"];
const DOT_CONFIG_FILENAMES = ["aiui.yaml", "aiui.yml", "aiui.json"];

function userCwd(): string {
    return process.env.AIUI_USER_CWD || process.cwd();
}

function xdgConfigHome(): string {
    return process.env.XDG_CONFIG_HOME || resolve(homedir(), ".config");
}

interface ProviderEntry {
    name?: string;
    type?: "openai" | "azure";
    base_url?: string;
    api_version?: string | null;
    api_key?: string | null;
    default_params?: Record<string, unknown>;
    http_proxy?: Record<string, string> | null;
    document_page?: string;
    model_page?: string;
    is_local?: boolean;
    enabled?: boolean;
}

interface ModelEntry {
    name?: string;
    provider?: string;  // provider name (preferred) or id
    upstream_model_id?: string;
    type?: "chat" | "embedding" | "audio" | "reranker";
    default_params?: Record<string, unknown>;
    context_window?: number | null;
    max_tokens?: number | null;
    output_dimension?: number | null;
    description?: string | null;
    knowledge_date?: string | null;
    timeout?: number;
    max_retries?: number;
    http_proxy?: Record<string, string> | null;
    enabled?: boolean;
}

interface ConfigFile {
    master_key?: string;
    providers?: ProviderEntry[];
    models?: ModelEntry[];
}

function locateConfigFile(): string | null {
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

/** Recursively replace `${VAR}` placeholders with the corresponding env var. */
function interpolateEnv<T>(value: T): T {
    if (typeof value === "string") {
        return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_match, name) => process.env[name] ?? "") as unknown as T;
    }
    if (Array.isArray(value)) {
        return value.map((v) => interpolateEnv(v)) as unknown as T;
    }
    if (value && typeof value === "object") {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            out[k] = interpolateEnv(v);
        }
        return out as unknown as T;
    }
    return value;
}

function parseConfig(path: string): ConfigFile {
    const text = readFileSync(path, "utf8");
    const raw = path.endsWith(".json") ? JSON.parse(text) : parseYaml(text);
    return interpolateEnv(raw ?? {}) as ConfigFile;
}

function upsertProvider(entry: ProviderEntry): { id: string; name: string } | null {
    const name = entry.name?.trim();
    const baseUrl = entry.base_url?.trim();
    if (!name) {
        console.warn("[aiui:config] skipping provider with no name");
        return null;
    }
    if (!baseUrl) {
        console.warn(`[aiui:config] provider "${name}" missing base_url; skipping`);
        return null;
    }
    const type: "openai" | "azure" = entry.type === "azure" ? "azure" : "openai";

    const existing = db.select().from(schema.providers).where(eq(schema.providers.name, name)).get();

    const apiKey = entry.api_key?.trim() ? entry.api_key.trim() : null;
    const updatesCommon = {
        type,
        baseUrl,
        apiVersion: entry.api_version?.trim() || null,
        defaultParams: entry.default_params ?? {},
        httpProxy: entry.http_proxy ?? null,
        documentPage: entry.document_page ?? null,
        modelPage: entry.model_page ?? null,
        isLocal: !!entry.is_local,
        enabled: entry.enabled ?? true,
        updatedAt: new Date().toISOString(),
    };

    if (existing) {
        const patch: Partial<typeof schema.providers.$inferInsert> = { ...updatesCommon };
        // Only overwrite the stored key if the file actually specified one. This avoids
        // wiping a UI-managed secret just because the file omits `api_key`.
        if (entry.api_key !== undefined) {
            patch.apiKeyEncrypted = apiKey ? encryptSecret(apiKey) : null;
        }
        db.update(schema.providers).set(patch).where(eq(schema.providers.id, existing.id)).run();
        return { id: existing.id, name };
    }

    const id = randomUUID();
    db.insert(schema.providers).values({
        id,
        name,
        apiKeyEncrypted: apiKey ? encryptSecret(apiKey) : null,
        ...updatesCommon,
    }).run();
    return { id, name };
}

function upsertModel(entry: ModelEntry, providerNameToId: Map<string, string>): void {
    const name = entry.name?.trim();
    const providerKey = entry.provider?.trim();
    const upstream = entry.upstream_model_id?.trim();
    if (!name || !providerKey || !upstream) {
        console.warn(`[aiui:config] model entry missing name/provider/upstream_model_id; skipping (name=${name ?? "?"})`);
        return;
    }
    let providerId = providerNameToId.get(providerKey);
    if (!providerId) {
        // try DB lookup by name OR id
        const found =
            db.select().from(schema.providers).where(eq(schema.providers.name, providerKey)).get() ||
            db.select().from(schema.providers).where(eq(schema.providers.id, providerKey)).get();
        if (!found) {
            console.warn(`[aiui:config] model "${name}" references unknown provider "${providerKey}"; skipping`);
            return;
        }
        providerId = found.id;
    }

    const existing = db.select().from(schema.models).where(eq(schema.models.name, name)).get();
    const updates = {
        providerId,
        upstreamModelId: upstream,
        type: entry.type ?? "chat",
        defaultParams: entry.default_params ?? {},
        contextWindow: entry.context_window ?? null,
        maxTokens: entry.max_tokens ?? null,
        outputDimension: entry.output_dimension ?? null,
        description: entry.description ?? null,
        knowledgeDate: entry.knowledge_date ?? null,
        timeout: entry.timeout ?? 60,
        maxRetries: entry.max_retries ?? 2,
        httpProxy: entry.http_proxy ?? null,
        enabled: entry.enabled ?? true,
        updatedAt: new Date().toISOString(),
    };

    if (existing) {
        db.update(schema.models).set(updates).where(eq(schema.models.id, existing.id)).run();
    } else {
        db.insert(schema.models).values({ id: randomUUID(), name, ...updates }).run();
    }
}

let loaded = false;

export function loadConfigFile(): void {
    if (loaded) return;
    loaded = true;

    const path = locateConfigFile();
    if (!path) return;

    let cfg: ConfigFile;
    try {
        cfg = parseConfig(path);
    } catch (err) {
        console.error(`[aiui:config] failed to parse ${path}:`, err);
        return;
    }

    // Hoist master_key BEFORE anything that may call encryptSecret/decryptSecret.
    // Env var wins so deployments that inject secrets via env are unaffected.
    if (typeof cfg.master_key === "string" && cfg.master_key.trim() && !process.env.AIUI_MASTER_KEY) {
        process.env.AIUI_MASTER_KEY = cfg.master_key.trim();
        console.log(`[aiui:config] master_key sourced from ${path}.`);
    }

    const providers = Array.isArray(cfg.providers) ? cfg.providers : [];
    const models = Array.isArray(cfg.models) ? cfg.models : [];
    if (providers.length === 0 && models.length === 0) {
        console.log(`[aiui:config] ${path} loaded but contained no providers/models.`);
        return;
    }

    const providerNameToId = new Map<string, string>();
    let providerCount = 0;
    for (const entry of providers) {
        try {
            const result = upsertProvider(entry);
            if (result) {
                providerNameToId.set(result.name, result.id);
                providerCount++;
            }
        } catch (err) {
            console.error(`[aiui:config] upsert provider "${entry.name}" failed:`, err);
        }
    }

    let modelCount = 0;
    for (const entry of models) {
        try {
            upsertModel(entry, providerNameToId);
            modelCount++;
        } catch (err) {
            console.error(`[aiui:config] upsert model "${entry.name}" failed:`, err);
        }
    }

    console.log(`[aiui:config] ${path}: upserted ${providerCount} provider(s), ${modelCount} model(s).`);
}
