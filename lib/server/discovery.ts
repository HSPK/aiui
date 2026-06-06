import "server-only";
import { db, schema } from "./db";
import { decryptSecret } from "./crypto";
import { classifyModel } from "./capabilities";
import "./capabilities/register";
import type { Provider } from "./db/schema";

/**
 * Dynamic model discovery. Each provider exposes a `/models` (or
 * `/openai/models?api-version=…` for Azure) endpoint that lists what's
 * currently available. Results are cached per-provider with a short TTL so we
 * don't hammer upstreams on every request.
 *
 * Important Azure caveat: Azure's catalog endpoint returns base model names
 * like `gpt-4o`, not deployment names — and you can't call a model directly
 * by name in Azure, you have to call a deployment. Listing deployments
 * requires `/openai/deployments?api-version=…`, which usually needs
 * management-plane permissions that the data-plane api-key doesn't have.
 *
 * So for Azure providers, dynamic discovery is best-effort: we try the
 * deployments endpoint first (callable IDs), then fall back to /models
 * (informational), and quietly tolerate failures. Azure users who want to
 * reliably call their deployments should register them as rows in the local
 * `models` table via the admin UI.
 */

export interface DiscoveredModel {
    /** The id the user supplies as `"model"` in their request. */
    id: string;
    /** Provider id this model belongs to (DB primary key). */
    provider_id: string;
    /** Convenience copy of the provider's name. */
    provider_name: string;
    /** "deployment" for Azure deployments, "model" for the OpenAI catalog. */
    object: "model" | "deployment";
    /** Inferred capability id (chat | embedding | image | …) from name heuristics. */
    capability: string;
    /** Unix timestamp from upstream if available. */
    created?: number;
}

interface CacheEntry {
    fetchedAt: number;
    models: DiscoveredModel[];
    error: string | null;
}

const cache = new Map<string, CacheEntry>();

function cacheTtlMs(): number {
    const seconds = Number(process.env.AIUI_MODELS_CACHE_TTL);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    return 5 * 60 * 1000;  // 5-minute default
}

function isFresh(entry: CacheEntry): boolean {
    return Date.now() - entry.fetchedAt < cacheTtlMs();
}

function buildHeaders(provider: Provider): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    const key = decryptSecret(provider.apiKeyEncrypted);
    if (key) {
        if (provider.type === "azure") h["api-key"] = key;
        else h["Authorization"] = `Bearer ${key}`;
    }
    return h;
}

async function fetchJson(url: string, headers: Record<string, string>): Promise<unknown> {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    return res.json();
}

/** Fetch the model list for a provider, bypassing the cache. */
export async function discoverModels(provider: Provider): Promise<DiscoveredModel[]> {
    const base = provider.baseUrl.replace(/\/$/, "");
    const headers = buildHeaders(provider);

    if (provider.type === "azure") {
        const apiVersion = provider.apiVersion?.trim() || "2024-10-21";
        // Prefer deployments (callable IDs) if the api-key has access; fall back
        // to the model catalog (informational) otherwise.
        try {
            const json = (await fetchJson(
                `${base}/openai/deployments?api-version=${encodeURIComponent(apiVersion)}`,
                headers,
            )) as { data?: Array<{ id: string; model?: string; created?: number }> };
            if (Array.isArray(json?.data)) {
                return json.data.map((d) => ({
                    id: d.id,
                    provider_id: provider.id,
                    provider_name: provider.name,
                    object: "deployment" as const,
                    capability: classifyModel(d.model ?? d.id),
                    created: d.created,
                }));
            }
        } catch {
            // intentionally swallow — try the catalog fallback below
        }
        const json = (await fetchJson(
            `${base}/openai/models?api-version=${encodeURIComponent(apiVersion)}`,
            headers,
        )) as { data?: Array<{ id: string; created?: number }> };
        if (!Array.isArray(json?.data)) return [];
        return json.data.map((m) => ({
            id: m.id,
            provider_id: provider.id,
            provider_name: provider.name,
            object: "model" as const,
            capability: classifyModel(m.id),
            created: m.created,
        }));
    }

    // OpenAI-compatible
    const json = (await fetchJson(`${base}/models`, headers)) as {
        data?: Array<{ id: string; created?: number }>;
    };
    if (!Array.isArray(json?.data)) return [];
    return json.data.map((m) => ({
        id: m.id,
        provider_id: provider.id,
        provider_name: provider.name,
        object: "model" as const,
        capability: classifyModel(m.id),
        created: m.created,
    }));
}

async function refreshProvider(provider: Provider): Promise<CacheEntry> {
    const entry: CacheEntry = { fetchedAt: Date.now(), models: [], error: null };
    try {
        entry.models = await discoverModels(provider);
    } catch (err) {
        entry.error = err instanceof Error ? err.message : String(err);
        // Keep stale models if we had any, so a transient upstream blip doesn't blank the list
        const prev = cache.get(provider.id);
        if (prev?.models?.length) entry.models = prev.models;
    }
    cache.set(provider.id, entry);
    return entry;
}

async function getEntry(provider: Provider, opts: { force?: boolean } = {}): Promise<CacheEntry> {
    const existing = cache.get(provider.id);
    if (!opts.force && existing && isFresh(existing)) return existing;
    return refreshProvider(provider);
}

function enabledProviders(): Provider[] {
    return db.select().from(schema.providers).all().filter((p) => p.enabled);
}

/**
 * Return the union of every enabled provider's discovered models. Failures on
 * individual providers are tolerated — they just contribute fewer entries.
 */
export async function listAllDiscovered(opts: { force?: boolean } = {}): Promise<DiscoveredModel[]> {
    const providers = enabledProviders();
    const entries = await Promise.all(providers.map((p) => getEntry(p, opts)));
    const out: DiscoveredModel[] = [];
    for (const e of entries) out.push(...e.models);
    return out;
}

/** Best-effort per-provider count of discovered models (zero on failure). */
export async function discoveredCountByProvider(): Promise<Record<string, number>> {
    const providers = enabledProviders();
    const entries = await Promise.all(providers.map((p) => getEntry(p)));
    const out: Record<string, number> = {};
    providers.forEach((p, i) => { out[p.id] = entries[i].models.length; });
    return out;
}

/**
 * Locate which enabled provider exposes a model with the given id. Returns
 * the first match; ordering is the providers table's natural row order.
 */
export async function resolveByDiscovery(
    modelName: string,
): Promise<{ provider: Provider; upstreamModelId: string } | null> {
    const providers = enabledProviders();
    for (const p of providers) {
        const entry = await getEntry(p);
        const hit = entry.models.find((m) => m.id === modelName);
        if (hit) return { provider: p, upstreamModelId: hit.id };
    }
    return null;
}

/** Lookup the last cache state for a provider (no fetch). */
export function getDiscoveryStatus(providerId: string): CacheEntry | null {
    return cache.get(providerId) ?? null;
}

/** Drop the entire cache (e.g. on provider mutation). */
export function clearDiscoveryCache(): void {
    cache.clear();
}
