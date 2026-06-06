import "server-only";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { eq } from "drizzle-orm";
import { db, schema } from "./db";
import { encryptSecret } from "./crypto";

/**
 * Local config file shape (YAML or JSON). Loaded once at server boot and
 * upserted into the DB by `name`. Entries already in the DB but not in the
 * file are left untouched — this is additive declarative, not strict
 * declarative, so UI-driven and file-driven configuration coexist.
 *
 * Values may reference environment variables via `${VAR}` interpolation
 * (e.g. `api_key: ${OPENAI_API_KEY}`).
 *
 * Example:
 *
 *   providers:
 *     - name: openai
 *       type: openai
 *       base_url: https://api.openai.com/v1
 *       api_key: ${OPENAI_API_KEY}
 *     - name: azure-eastus
 *       type: azure
 *       base_url: https://my-resource.openai.azure.com
 *       api_version: "2024-10-21"
 *       api_key: ${AZURE_OPENAI_API_KEY}
 *
 *   models:
 *     - name: gpt-4o-mini
 *       provider: openai
 *       upstream_model_id: gpt-4o-mini
 *       type: chat
 *       context_window: 128000
 *     - name: azure-gpt-4o
 *       provider: azure-eastus
 *       upstream_model_id: my-gpt-4o-deployment  # the Azure deployment name
 *       type: chat
 */

const DEFAULT_PATHS = [
    "aiui.config.yaml",
    "aiui.config.yml",
    "aiui.config.json",
];

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
    providers?: ProviderEntry[];
    models?: ModelEntry[];
}

function locateConfigFile(): string | null {
    const explicit = process.env.AIUI_CONFIG_PATH;
    if (explicit) {
        const p = resolve(process.cwd(), explicit);
        return existsSync(p) ? p : null;
    }
    for (const rel of DEFAULT_PATHS) {
        const p = resolve(process.cwd(), rel);
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
