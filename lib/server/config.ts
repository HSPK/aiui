import "server-only";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "./db";
import { encryptSecret } from "./crypto";
import { preflightFromConfig } from "@/lib/preflight";
import { resolveAdapter } from "./adapters";
import "./adapters/register";
import type { Provider } from "./db/schema";

/**
 * Local config file loader (server side).
 *
 * The search order and the YAML schema are defined in lib/preflight.ts so
 * the CLI (bin/loom.mjs) and the server can share one source of truth.
 *
 * Top-level fields applied as env vars (master_key, database.path, admin.*,
 * session.*, cache.*, server.*) are hoisted by `preflightFromConfig()` so they
 * are visible to every other server module via process.env. Env vars that
 * are already set take precedence.
 *
 * This file additionally upserts `providers[]` into the SQLite DB by `name`.
 * Entries already in the DB but absent from the file are left untouched
 * (declarative-but-additive, so UI-managed and file-managed configuration
 * coexist).
 *
 * `models[]` is intentionally NOT a config-file concept anymore — models are
 * discovered live from each provider's `/models` endpoint (see
 * lib/server/discovery.ts).
 */

interface ProviderEntry {
    name?: string;
    /** Explicit adapter id; if omitted, the registry auto-detects via base_url. */
    adapter_id?: string;
    base_url?: string;
    api_version?: string | null;
    api_key?: string | null;
    default_params?: Record<string, unknown>;
    http_proxy?: Record<string, string> | null;
    document_page?: string;
    model_page?: string;
    health_check_url?: string | null;
    is_local?: boolean;
    enabled?: boolean;
}

/** Pick the adapter id for a config entry: explicit field wins, else
 *  the registry's `matches()` pass against the entry's base_url. */
function adapterIdFor(entry: ProviderEntry): string {
    if (entry.adapter_id && entry.adapter_id.trim()) return entry.adapter_id.trim();
    const probe: Provider = {
        id: "",
        name: "",
        adapterId: "",
        baseUrl: entry.base_url ?? "",
        apiVersion: entry.api_version ?? null,
        apiKeyEncrypted: null,
        defaultParams: {},
        httpProxy: null,
        documentPage: null,
        modelPage: null,
        healthCheckUrl: null,
        lastHealthStatus: null,
        lastHealthCheckedAt: null,
        lastHealthError: null,
        isLocal: false,
        enabled: true,
        createdAt: "",
        updatedAt: "",
    };
    return resolveAdapter(probe).id;
}

function upsertProvider(entry: ProviderEntry): { id: string; name: string } | null {
    const name = entry.name?.trim();
    const baseUrl = entry.base_url?.trim();
    if (!name) {
        console.warn("[loom:config] skipping provider with no name");
        return null;
    }
    if (!baseUrl) {
        console.warn(`[loom:config] provider "${name}" missing base_url; skipping`);
        return null;
    }
    const adapterId = adapterIdFor({ ...entry, base_url: baseUrl });

    const existing = db.select().from(schema.providers).where(eq(schema.providers.name, name)).get();

    const apiKey = entry.api_key?.trim() ? entry.api_key.trim() : null;
    const updatesCommon = {
        adapterId,
        baseUrl,
        apiVersion: entry.api_version?.trim() || null,
        defaultParams: entry.default_params ?? {},
        httpProxy: entry.http_proxy ?? null,
        documentPage: entry.document_page ?? null,
        modelPage: entry.model_page ?? null,
        healthCheckUrl: entry.health_check_url?.trim() || null,
        isLocal: !!entry.is_local,
        enabled: entry.enabled ?? true,
        updatedAt: new Date().toISOString(),
    };

    if (existing) {
        const patch: Partial<typeof schema.providers.$inferInsert> = { ...updatesCommon };
        // Only overwrite the stored key if the file specified one — protects
        // a UI-managed secret from being wiped just because the file omits api_key.
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

let loaded = false;

export function loadConfigFile(): void {
    if (loaded) return;
    loaded = true;

    const { path, cfg, applied } = preflightFromConfig();
    if (!path || !cfg) return;

    if (applied.length > 0) {
        console.log(`[loom:config] ${path}: applied env from config (${applied.join(", ")}).`);
    } else {
        console.log(`[loom:config] ${path} loaded.`);
    }

    if (Array.isArray((cfg as { models?: unknown[] }).models)) {
        console.warn(
            `[loom:config] ${path}: \`models:\` section is deprecated — models are now ` +
            `discovered live from each provider's /models endpoint. Use the admin UI ` +
            `to add per-model overrides (Azure deployments, display-name aliases, etc.).`
        );
    }

    const providers = Array.isArray((cfg as { providers?: ProviderEntry[] }).providers)
        ? (cfg as { providers: ProviderEntry[] }).providers
        : [];
    if (providers.length === 0) return;

    let count = 0;
    for (const entry of providers) {
        try {
            if (upsertProvider(entry)) count++;
        } catch (err) {
            console.error(`[loom:config] upsert provider "${entry.name}" failed:`, err);
        }
    }

    if (count > 0) console.log(`[loom:config] upserted ${count} provider(s).`);
}
