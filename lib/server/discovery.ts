import "server-only";
import { db, schema } from "./db";
import { decryptSecret } from "./crypto";
import { classifyModel } from "./capabilities";
import "./capabilities/register";
import { resolveAdapter } from "./adapters";
import "./adapters/register";
import type { NormalizedModelMeta } from "@/lib/schemas/adapter";
import type { Provider } from "./db/schema";

/**
 * Dynamic model discovery.
 *
 * Each provider's `/models`-style endpoint is fetched by its registered
 * ProviderAdapter (`lib/server/adapters/`). The adapter is the single
 * point of variability — it handles URL/header quirks, parses the
 * upstream-specific JSON, and projects each raw entry into a
 * NormalizedModelMeta. Results are cached per-provider with a short TTL
 * so we don't hammer upstreams on every request.
 *
 * Important Azure caveat: the Azure-OpenAI catalog endpoint returns base
 * model names (`gpt-4o`), not callable deployment names. The
 * `azure-openai` adapter surfaces those with `capabilities.chat=false`
 * so admins know to register a deployment override row.
 */

export interface DiscoveredModel {
    /** The id the user supplies as `"model"` in their request. */
    id: string;
    /** Provider id this model belongs to (DB primary key). */
    provider_id: string;
    /** Convenience copy of the provider's name. */
    provider_name: string;
    /** Adapter id that fetched this entry. */
    adapter_id: string;
    /** Inferred capability id (chat | embedding | image | …) — adapter
     *  projection first, then heuristic fallback. */
    capability: string;
    /** Full normalized projection — see lib/schemas/adapter.ts. */
    meta: NormalizedModelMeta;
}

interface CacheEntry {
    fetchedAt: number;
    models: DiscoveredModel[];
    error: string | null;
}

const cache = new Map<string, CacheEntry>();

function cacheTtlMs(): number {
    const seconds = Number(process.env.LOOM_MODELS_CACHE_TTL);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    return 5 * 60 * 1000;  // 5-minute default
}

function isFresh(entry: CacheEntry): boolean {
    return Date.now() - entry.fetchedAt < cacheTtlMs();
}

/**
 * Walk the adapter's NormalizedModelMeta to decide which gateway
 * capability id ("chat", "embedding", "image", …) this model serves.
 * Falls back to name heuristics when the adapter didn't say.
 */
function capabilityFromMeta(meta: NormalizedModelMeta, fallbackId: string): string {
    const c = meta.capabilities;
    if (c.embeddings) return "embedding";
    if (c.audio_in || c.audio_out) {
        // Coarse — most providers won't distinguish here.
        return c.audio_in ? "audio.transcription" : "audio.speech";
    }
    if (c.chat || c.responses) return "chat";
    return classifyModel(fallbackId);
}

/** Fetch the model list for a provider via its adapter, bypassing the cache. */
export async function discoverModels(provider: Provider): Promise<DiscoveredModel[]> {
    const adapter = resolveAdapter(provider);
    const apiKey = decryptSecret(provider.apiKeyEncrypted);

    const rawEntries = await adapter.fetchModels(provider, apiKey);
    const out: DiscoveredModel[] = [];
    for (const raw of rawEntries) {
        const meta = adapter.extractModelMeta(raw, provider);
        if (!meta) continue;
        out.push({
            id: meta.upstream_id,
            provider_id: provider.id,
            provider_name: provider.name,
            adapter_id: adapter.id,
            capability: capabilityFromMeta(meta, meta.upstream_id),
            meta,
        });
    }
    return out;
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
 * the first match in providers-table order; cache entries are fetched in
 * parallel so total latency is bounded by the slowest provider, not the
 * sum across them.
 */
export async function resolveByDiscovery(
    modelName: string,
): Promise<{ provider: Provider; upstreamModelId: string; meta: NormalizedModelMeta } | null> {
    const providers = enabledProviders();
    const entries = await Promise.all(providers.map((p) => getEntry(p)));
    for (let i = 0; i < providers.length; i++) {
        const hit = entries[i].models.find((m) => m.id === modelName);
        if (hit) return { provider: providers[i], upstreamModelId: hit.id, meta: hit.meta };
    }
    return null;
}

/** Cache-aware per-provider model list. Refreshes when stale, returns
 *  the cached entry otherwise. Prefer this over `discoverModels` from
 *  outside this module — it populates the cache so subsequent
 *  `getDiscoveryStatus` lookups see fresh data. */
export async function discoveredForProvider(
    provider: Provider,
    opts: { force?: boolean } = {},
): Promise<DiscoveredModel[]> {
    const entry = await getEntry(provider, opts);
    return entry.models;
}

/** Lookup the last cache state for a provider (no fetch). */
export function getDiscoveryStatus(providerId: string): CacheEntry | null {
    return cache.get(providerId) ?? null;
}

/** Drop the entire cache (e.g. on provider mutation). */
export function clearDiscoveryCache(): void {
    cache.clear();
}
