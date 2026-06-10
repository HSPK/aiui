import "server-only";
import { eq } from "drizzle-orm";
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
    /** Wall-clock of the last *successful* discovery write. On the
     *  error path we keep stale models but DO NOT bump this — used
     *  by `isFresh` so a transient failure doesn't silence the
     *  provider for the full TTL. */
    lastSuccessAt: number;
    /** Generation tag captured at the moment the in-flight refresh
     *  started. Bumped by every cache eviction. The refresher's
     *  writeback no-ops if the tag has moved underneath it, which
     *  prevents a slow upstream fetch from clobbering a fresh
     *  invalidation triggered by a config change mid-flight. */
    generation: number;
    models: DiscoveredModel[];
    error: string | null;
}

const cache = new Map<string, CacheEntry>();
// In-flight refreshes — coalesces a thundering herd of concurrent
// stale lookups into a single upstream /models request. The first
// caller starts the fetch, subsequent callers reuse the same promise.
const pendingRefresh = new Map<string, Promise<CacheEntry>>();
// Monotonic per-provider generation counter. Bumped on every
// cache eviction so an in-flight refresh that started with an older
// generation can detect "I'm stale" and refuse to write back. The
// pendingRefresh map is ALSO cleared so subsequent callers don't
// await the doomed promise.
const providerGeneration = new Map<string, number>();
// Cool-down before we'll retry after a discovery failure — keeps a
// transient blip (DNS hiccup, momentary 502, etc.) from silencing
// the provider for the full TTL. Short enough that the next request
// re-probes within seconds; long enough that we don't melt the
// upstream during a sustained outage.
const ERROR_RETRY_COOLDOWN_MS = 15_000;

function currentGeneration(providerId: string): number {
    return providerGeneration.get(providerId) ?? 0;
}

function bumpGeneration(providerId: string): number {
    const next = currentGeneration(providerId) + 1;
    providerGeneration.set(providerId, next);
    return next;
}

function cacheTtlMs(): number {
    const seconds = Number(process.env.LOOM_MODELS_CACHE_TTL);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    return 5 * 60 * 1000;  // 5-minute default
}

function isFresh(entry: CacheEntry): boolean {
    if (entry.error) {
        // Failed last time — re-probe after a short cool-down so
        // transient upstream blips don't silence the provider for
        // the full TTL.
        return Date.now() - entry.fetchedAt < ERROR_RETRY_COOLDOWN_MS;
    }
    return Date.now() - entry.lastSuccessAt < cacheTtlMs();
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
            adapter_id: adapter.id,
            capability: capabilityFromMeta(meta, meta.upstream_id),
            meta,
        });
    }
    return out;
}

async function refreshProvider(provider: Provider): Promise<CacheEntry> {
    // Coalesce concurrent refreshers — without this, a discovery
    // route hit + a chat request triggering resolveByDiscovery can
    // both miss the cache simultaneously and each fire the upstream
    // /models call. Same provider id → same in-flight promise.
    const inflight = pendingRefresh.get(provider.id);
    if (inflight) return inflight;

    // Snapshot the generation at fetch dispatch — if invalidation
    // happens mid-flight, providerGeneration will have moved past
    // this value and the writeback below becomes a no-op.
    const startedGeneration = currentGeneration(provider.id);
    const now = Date.now();
    const fresh = (async () => {
        const prev = cache.get(provider.id);
        const entry: CacheEntry = {
            fetchedAt: now,
            lastSuccessAt: prev?.lastSuccessAt ?? 0,
            generation: startedGeneration,
            models: [],
            error: null,
        };
        try {
            entry.models = await discoverModels(provider);
            entry.lastSuccessAt = Date.now();
        } catch (err) {
            entry.error = err instanceof Error ? err.message : String(err);
            // Keep stale models if we had any, so a transient upstream blip doesn't blank the list
            if (prev?.models?.length) entry.models = prev.models;
        }
        // Stale-writeback guard — if the cache was invalidated while
        // we were fetching (admin edited base_url / api_key / etc.),
        // refuse to install the now-stale result.
        if (currentGeneration(provider.id) === startedGeneration) {
            cache.set(provider.id, entry);
        }
        return entry;
    })().finally(() => {
        // Only delete OUR inflight promise — a clearDiscoveryCacheFor
        // mid-flight may have already replaced this entry with a new
        // refresher, and we don't want to evict that one.
        if (pendingRefresh.get(provider.id) === fresh) {
            pendingRefresh.delete(provider.id);
        }
    });

    pendingRefresh.set(provider.id, fresh);
    return fresh;
}

async function getEntry(provider: Provider, opts: { force?: boolean } = {}): Promise<CacheEntry> {
    const existing = cache.get(provider.id);
    if (!opts.force && existing && isFresh(existing)) return existing;
    return refreshProvider(provider);
}

/** Stable provider ordering for discovery walks. Without ORDER BY,
 *  SQLite is free to return rows in arbitrary order (typically rowid
 *  order, but not guaranteed across vacuum/rebuild), which makes
 *  `resolveByDiscovery` non-deterministic when two providers expose
 *  the same model name. Ordering by `createdAt` gives admins a
 *  predictable "first registered wins" semantic; the id tiebreaker
 *  protects against same-tick inserts. */
function enabledProviders(): Provider[] {
    return db
        .select()
        .from(schema.providers)
        .where(eq(schema.providers.enabled, true))
        .orderBy(schema.providers.createdAt, schema.providers.id)
        .all();
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

/** Best-effort count of discovered models for a single provider. */
export async function discoveredCountForProvider(provider: Provider): Promise<number> {
    if (!provider.enabled) return 0;
    const entry = await getEntry(provider);
    return entry.models.length;
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

/** Drop the entire cache (e.g. on global reload). Prefer
 *  `clearDiscoveryCacheFor(providerId)` for single-provider edits so
 *  unrelated providers don't pay the next-request upstream-fetch tax.
 *  Also bumps every known provider's generation tag + drops every
 *  in-flight refresher so any racing fetch can't write back stale data. */
export function clearDiscoveryCache(): void {
    // Bump generations for every provider that has been touched —
    // covers both the cached set and any in-flight refresher whose
    // entry hasn't landed yet.
    const ids = new Set<string>();
    for (const id of cache.keys()) ids.add(id);
    for (const id of pendingRefresh.keys()) ids.add(id);
    for (const id of providerGeneration.keys()) ids.add(id);
    for (const id of ids) bumpGeneration(id);
    cache.clear();
    pendingRefresh.clear();
}

/** Evict a single provider's cached entry. Cheaper than `clearDiscoveryCache()`
 *  for the common case of editing one provider — leaves other providers'
 *  hot caches intact so the very next `GET /providers` (which calls
 *  `discoveredCountByProvider`) doesn't fan out parallel `/models`
 *  fetches across every other upstream. Also drops the in-flight
 *  refresher (if any) and bumps the generation tag so the racing
 *  fetch — which captured the OLD config — can't write its result
 *  back as fresh. */
export function clearDiscoveryCacheFor(providerId: string): void {
    bumpGeneration(providerId);
    cache.delete(providerId);
    pendingRefresh.delete(providerId);
}
