// Tests for lib/server/discovery.ts — the model-discovery cache layer
// sitting on top of each provider's ProviderAdapter.fetchModels().
//
// A local fake adapter (matches: () => false, so it never auto-attaches)
// gives full control over fetchModels/extractModelMeta so the TTL,
// error-cooldown, coalescing and generation-guard behaviour can be
// exercised deterministically — real adapters hit a real HTTP endpoint,
// which isn't something this suite is allowed to do.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerAdapter, type ProviderAdapter } from "@/lib/server/adapters";
import {
    clearDiscoveryCache,
    clearDiscoveryCacheFor,
    discoverModels,
    discoveredCountByProvider,
    discoveredCountForProvider,
    discoveredForProvider,
    getDiscoveryStatus,
    listAllDiscovered,
    resolveByDiscovery,
} from "@/lib/server/discovery";
import type { AdapterId, NormalizedModelMeta } from "@/lib/schemas/adapter";
import type { Provider } from "@/lib/server/db/schema";
import { resetDb, seedProvider } from "@/tests/helpers/db";

const TEST_ADAPTER_ID = "test-discovery-adapter" as AdapterId;

/** Per-provider raw `/models` payloads the fake fetchModels serves. */
let providerModels: Map<string, unknown[]>;
/** Per-provider fetch behaviour override (e.g. to reject, or to defer). */
let providerFetchImpl: Map<string, (provider: Provider) => Promise<unknown[]>>;
let fetchCallCounts: Map<string, number>;
/** Identity by default — tests override per-case for capability derivation. */
let extractMetaImpl: (raw: unknown, provider: Provider) => NormalizedModelMeta | null;

const testAdapter: ProviderAdapter = {
    id: TEST_ADAPTER_ID,
    label: "Test discovery adapter",
    matches: () => false,
    fetchModels: async (provider) => {
        fetchCallCounts.set(provider.id, (fetchCallCounts.get(provider.id) ?? 0) + 1);
        const override = providerFetchImpl.get(provider.id);
        if (override) return override(provider);
        return providerModels.get(provider.id) ?? [];
    },
    extractModelMeta: (raw, provider) => extractMetaImpl(raw, provider),
    upstreamUrl: () => "https://example.test/v1/chat/completions",
    upstreamHeaders: () => ({}),
};
registerAdapter(testAdapter);

function baseMeta(overrides: Partial<NormalizedModelMeta> = {}): NormalizedModelMeta {
    return {
        upstream_id: "model-a",
        supported_apis: [],
        capabilities: {},
        ...overrides,
    };
}

/** Safe default extractModelMeta: derives a fully-shaped NormalizedModelMeta
 *  from a plain `{ id }` raw fixture so tests that don't care about
 *  capability details don't need to specify one — and, critically, don't
 *  crash inside `capabilityFromMeta` (which unconditionally reads
 *  `meta.capabilities.*`) the way a naive identity cast would. */
function defaultExtractMeta(raw: unknown): NormalizedModelMeta {
    const id = (raw as { id?: string } | null)?.id ?? "unknown-model";
    return baseMeta({ upstream_id: id });
}

function seedTestProvider(overrides: Partial<Provider> = {}): Provider {
    return seedProvider({ adapterId: TEST_ADAPTER_ID, ...overrides });
}

beforeEach(() => {
    resetDb();
    providerModels = new Map();
    providerFetchImpl = new Map();
    fetchCallCounts = new Map();
    extractMetaImpl = defaultExtractMeta;
    // Every module-cached provider id is fresh (random uuid) per test, but
    // clearing keeps `getDiscoveryStatus` assertions honest even if a
    // prior test's provider id were ever reused.
    clearDiscoveryCache();
});
afterEach(() => {
    vi.useRealTimers();
});

describe("discoverModels", () => {
    it("maps raw entries through the adapter into DiscoveredModel[]", async () => {
        const provider = seedTestProvider();
        providerModels.set(provider.id, [{ id: "model-a" }, { id: "model-b" }]);
        extractMetaImpl = (raw) => baseMeta({ upstream_id: (raw as { id: string }).id });

        const models = await discoverModels(provider);
        expect(models).toHaveLength(2);
        expect(models[0]).toMatchObject({
            id: "model-a",
            provider_id: provider.id,
            adapter_id: TEST_ADAPTER_ID,
        });
        expect(models[1].id).toBe("model-b");
    });

    it("skips entries where extractModelMeta returns null", async () => {
        const provider = seedTestProvider();
        providerModels.set(provider.id, [{ id: "keep" }, { id: "drop" }]);
        extractMetaImpl = (raw) => {
            const id = (raw as { id: string }).id;
            return id === "drop" ? null : baseMeta({ upstream_id: id });
        };

        const models = await discoverModels(provider);
        expect(models.map((m) => m.id)).toEqual(["keep"]);
    });

    it("bypasses the cache — two direct calls both hit fetchModels", async () => {
        const provider = seedTestProvider();
        providerModels.set(provider.id, [{ id: "model-a" }]);
        await discoverModels(provider);
        await discoverModels(provider);
        expect(fetchCallCounts.get(provider.id)).toBe(2);
    });

    describe("capability derivation (capabilityFromMeta via discoverModels)", () => {
        it("classifies a model with capabilities.embeddings as 'embedding'", async () => {
            const provider = seedTestProvider();
            providerModels.set(provider.id, [{ id: "m" }]);
            extractMetaImpl = () => baseMeta({ capabilities: { embeddings: true, chat: true } });
            const [m] = await discoverModels(provider);
            expect(m.capability).toBe("embedding"); // embeddings flag wins over chat
        });

        it("classifies audio_in as 'audio.transcription'", async () => {
            const provider = seedTestProvider();
            providerModels.set(provider.id, [{ id: "m" }]);
            extractMetaImpl = () => baseMeta({ capabilities: { audio_in: true } });
            const [m] = await discoverModels(provider);
            expect(m.capability).toBe("audio.transcription");
        });

        it("classifies audio_out (without audio_in) as 'audio.speech'", async () => {
            const provider = seedTestProvider();
            providerModels.set(provider.id, [{ id: "m" }]);
            extractMetaImpl = () => baseMeta({ capabilities: { audio_out: true } });
            const [m] = await discoverModels(provider);
            expect(m.capability).toBe("audio.speech");
        });

        it("classifies capabilities.chat as 'chat'", async () => {
            const provider = seedTestProvider();
            providerModels.set(provider.id, [{ id: "m" }]);
            extractMetaImpl = () => baseMeta({ capabilities: { chat: true } });
            const [m] = await discoverModels(provider);
            expect(m.capability).toBe("chat");
        });

        it("classifies capabilities.responses (without chat) as 'chat'", async () => {
            const provider = seedTestProvider();
            providerModels.set(provider.id, [{ id: "m" }]);
            extractMetaImpl = () => baseMeta({ capabilities: { responses: true } });
            const [m] = await discoverModels(provider);
            expect(m.capability).toBe("chat");
        });

        it("falls back to name-heuristic classifyModel when no capability flags are set", async () => {
            const provider = seedTestProvider();
            providerModels.set(provider.id, [{ id: "text-embedding-3-small" }]);
            extractMetaImpl = (raw) => baseMeta({ upstream_id: (raw as { id: string }).id, capabilities: {} });
            const [m] = await discoverModels(provider);
            expect(m.capability).toBe("embedding"); // via embedding.ts's name regex
        });

        it("falls back to the default 'chat' capability when nothing matches at all", async () => {
            const provider = seedTestProvider();
            providerModels.set(provider.id, [{ id: "totally-unclassified-widget-9000" }]);
            extractMetaImpl = (raw) => baseMeta({ upstream_id: (raw as { id: string }).id, capabilities: {} });
            const [m] = await discoverModels(provider);
            expect(m.capability).toBe("chat");
        });
    });
});

describe("resolveByDiscovery", () => {
    it("returns the provider/meta for the first enabled provider that exposes the model", async () => {
        const provider = seedTestProvider();
        providerModels.set(provider.id, [{ id: "shared-model" }]);
        extractMetaImpl = (raw) => baseMeta({ upstream_id: (raw as { id: string }).id, label: "Shared" });

        const hit = await resolveByDiscovery("shared-model");
        expect(hit).not.toBeNull();
        expect(hit?.provider.id).toBe(provider.id);
        expect(hit?.upstreamModelId).toBe("shared-model");
        expect(hit?.meta.label).toBe("Shared");
    });

    it("prefers the provider created first when two providers expose the same model id", async () => {
        const earlier = seedTestProvider({ createdAt: "2024-01-01T00:00:00.000Z" });
        const later = seedTestProvider({ createdAt: "2024-06-01T00:00:00.000Z" });
        providerModels.set(earlier.id, [{ id: "dup-model" }]);
        providerModels.set(later.id, [{ id: "dup-model" }]);
        extractMetaImpl = (raw, provider) =>
            baseMeta({ upstream_id: (raw as { id: string }).id, label: provider.id === earlier.id ? "earlier" : "later" });

        const hit = await resolveByDiscovery("dup-model");
        expect(hit?.provider.id).toBe(earlier.id);
        expect(hit?.meta.label).toBe("earlier");
    });

    it("ignores disabled providers entirely", async () => {
        const disabled = seedTestProvider({ enabled: false });
        providerModels.set(disabled.id, [{ id: "hidden-model" }]);

        const hit = await resolveByDiscovery("hidden-model");
        expect(hit).toBeNull();
        expect(fetchCallCounts.get(disabled.id)).toBeUndefined(); // never even queried
    });

    it("returns null when no enabled provider exposes the model", async () => {
        const provider = seedTestProvider();
        providerModels.set(provider.id, [{ id: "model-a" }]);
        const hit = await resolveByDiscovery("does-not-exist");
        expect(hit).toBeNull();
    });
});

describe("cache freshness / TTL", () => {
    afterEach(() => {
        delete process.env.LOOM_MODELS_CACHE_TTL;
    });

    it("reuses the cached entry on a second call within the TTL (default 5 minutes)", async () => {
        delete process.env.LOOM_MODELS_CACHE_TTL;
        const provider = seedTestProvider();
        providerModels.set(provider.id, [{ id: "model-a" }]);

        await discoveredForProvider(provider);
        await discoveredForProvider(provider);
        expect(fetchCallCounts.get(provider.id)).toBe(1);
    });

    it("re-fetches once the default 5-minute TTL has elapsed", async () => {
        vi.useFakeTimers();
        delete process.env.LOOM_MODELS_CACHE_TTL;
        const provider = seedTestProvider();
        providerModels.set(provider.id, [{ id: "model-a" }]);

        await discoveredForProvider(provider);
        expect(fetchCallCounts.get(provider.id)).toBe(1);

        vi.setSystemTime(Date.now() + 5 * 60 * 1000 + 1);
        await discoveredForProvider(provider);
        expect(fetchCallCounts.get(provider.id)).toBe(2);
    });

    it("honours a custom LOOM_MODELS_CACHE_TTL (seconds)", async () => {
        vi.useFakeTimers();
        process.env.LOOM_MODELS_CACHE_TTL = "10"; // 10 seconds
        const provider = seedTestProvider();
        providerModels.set(provider.id, [{ id: "model-a" }]);

        await discoveredForProvider(provider);
        vi.setSystemTime(Date.now() + 9_000);
        await discoveredForProvider(provider);
        expect(fetchCallCounts.get(provider.id)).toBe(1); // still fresh at 9s < 10s TTL

        vi.setSystemTime(Date.now() + 2_000); // total 11s elapsed
        await discoveredForProvider(provider);
        expect(fetchCallCounts.get(provider.id)).toBe(2);
    });

    it("treats a non-finite/negative LOOM_MODELS_CACHE_TTL as the 5-minute default", async () => {
        vi.useFakeTimers();
        process.env.LOOM_MODELS_CACHE_TTL = "not-a-number";
        const provider = seedTestProvider();
        providerModels.set(provider.id, [{ id: "model-a" }]);

        await discoveredForProvider(provider);
        vi.setSystemTime(Date.now() + 60_000); // well under the 5-minute fallback
        await discoveredForProvider(provider);
        expect(fetchCallCounts.get(provider.id)).toBe(1);
    });

    it("`force: true` re-fetches even when the cache is still fresh", async () => {
        const provider = seedTestProvider();
        providerModels.set(provider.id, [{ id: "model-a" }]);
        await discoveredForProvider(provider);
        await discoveredForProvider(provider, { force: true });
        expect(fetchCallCounts.get(provider.id)).toBe(2);
    });
});

describe("error-path cool-down", () => {
    it("keeps stale models from a prior success when a refresh fails", async () => {
        vi.useFakeTimers();
        process.env.LOOM_MODELS_CACHE_TTL = "1"; // 1 second, so we can expire quickly
        const provider = seedTestProvider();
        providerModels.set(provider.id, [{ id: "model-a" }]);
        extractMetaImpl = (raw) => baseMeta({ upstream_id: (raw as { id: string }).id });

        const first = await discoveredForProvider(provider);
        expect(first).toHaveLength(1);

        vi.setSystemTime(Date.now() + 1_100); // expire the 1s TTL
        providerFetchImpl.set(provider.id, async () => {
            throw new Error("upstream unreachable");
        });
        const second = await discoveredForProvider(provider);
        expect(second).toHaveLength(1); // stale model preserved
        expect(second[0].id).toBe("model-a");

        const status = getDiscoveryStatus(provider.id);
        expect(status?.error).toBe("upstream unreachable");
        delete process.env.LOOM_MODELS_CACHE_TTL;
    });

    it("does not retry within the 15s error cool-down, but does retry after it elapses", async () => {
        vi.useFakeTimers();
        const provider = seedTestProvider();
        providerFetchImpl.set(provider.id, async () => {
            throw new Error("boom");
        });

        await discoveredForProvider(provider);
        expect(fetchCallCounts.get(provider.id)).toBe(1);

        vi.setSystemTime(Date.now() + 14_000);
        await discoveredForProvider(provider);
        expect(fetchCallCounts.get(provider.id)).toBe(1); // still cooling down

        vi.setSystemTime(Date.now() + 2_000); // total 16s
        await discoveredForProvider(provider);
        expect(fetchCallCounts.get(provider.id)).toBe(2);
    });

    it("starts with an empty model list (not a throw) when the very first fetch fails", async () => {
        const provider = seedTestProvider();
        providerFetchImpl.set(provider.id, async () => {
            throw new Error("first call fails");
        });
        const models = await discoveredForProvider(provider);
        expect(models).toEqual([]);
        expect(getDiscoveryStatus(provider.id)?.error).toBe("first call fails");
    });

    it("stringifies a non-Error throw", async () => {
        const provider = seedTestProvider();
        providerFetchImpl.set(provider.id, async () => {
            // Deliberately a non-Error rejection: typed `unknown` so it is a
            // real runtime string without tripping the throw-an-Error lint.
            const rawThrown: unknown = "plain string failure";
            throw rawThrown;
        });
        await discoveredForProvider(provider);
        expect(getDiscoveryStatus(provider.id)?.error).toBe("plain string failure");
    });
});

describe("coalescing concurrent refreshes", () => {
    it("collapses two concurrent lookups for the same provider into a single fetchModels call", async () => {
        const provider = seedTestProvider();
        let releaseFetch: (models: unknown[]) => void = () => {};
        providerFetchImpl.set(provider.id, () => new Promise((resolve) => { releaseFetch = resolve; }));

        const p1 = discoveredForProvider(provider);
        const p2 = discoveredForProvider(provider);
        releaseFetch([{ id: "model-a" }]);
        extractMetaImpl = (raw) => baseMeta({ upstream_id: (raw as { id: string }).id });

        const [r1, r2] = await Promise.all([p1, p2]);
        expect(fetchCallCounts.get(provider.id)).toBe(1);
        expect(r1).toBe(r2); // same cached array reference
    });
});

describe("generation guard (stale-writeback protection)", () => {
    it("clearDiscoveryCacheFor mid-flight prevents the in-flight refresh from writing back", async () => {
        const provider = seedTestProvider();
        let releaseFetch: (models: unknown[]) => void = () => {};
        let fetchStarted: () => void = () => {};
        const started = new Promise<void>((resolve) => { fetchStarted = resolve; });
        providerFetchImpl.set(provider.id, () => {
            fetchStarted();
            return new Promise((resolve) => { releaseFetch = resolve; });
        });
        extractMetaImpl = (raw) => baseMeta({ upstream_id: (raw as { id: string }).id });

        const inFlight = discoveredForProvider(provider);
        await started; // fetchModels has been called; refreshProvider snapshot taken
        clearDiscoveryCacheFor(provider.id); // bumps generation while the fetch is still pending
        releaseFetch([{ id: "should-not-be-cached" }]);

        const result = await inFlight;
        // The caller still gets the (correct, just-fetched) result...
        expect(result.map((m) => m.id)).toEqual(["should-not-be-cached"]);
        // ...but the shared cache must NOT have been poisoned with the stale write.
        expect(getDiscoveryStatus(provider.id)).toBeNull();

        // A follow-up lookup must re-fetch from scratch (cache truly empty). The
        // one-shot override above has served its purpose (and its returned
        // promise would never resolve again), so swap in a plain fixture.
        providerFetchImpl.delete(provider.id);
        providerModels.set(provider.id, [{ id: "should-not-be-cached" }]);
        await discoveredForProvider(provider);
        expect(fetchCallCounts.get(provider.id)).toBe(2);
    });

    it("clearDiscoveryCache (global) also blocks a stale in-flight writeback", async () => {
        const provider = seedTestProvider();
        let releaseFetch: (models: unknown[]) => void = () => {};
        let fetchStarted: () => void = () => {};
        const started = new Promise<void>((resolve) => { fetchStarted = resolve; });
        providerFetchImpl.set(provider.id, () => {
            fetchStarted();
            return new Promise((resolve) => { releaseFetch = resolve; });
        });

        const inFlight = discoveredForProvider(provider);
        await started;
        clearDiscoveryCache();
        releaseFetch([{ id: "model-a" }]);
        await inFlight;

        expect(getDiscoveryStatus(provider.id)).toBeNull();
    });
});

describe("getDiscoveryStatus", () => {
    it("returns null for a provider that has never been discovered", () => {
        expect(getDiscoveryStatus("no-such-provider-id")).toBeNull();
    });

    it("returns the populated cache entry after a successful discovery", async () => {
        const provider = seedTestProvider();
        providerModels.set(provider.id, [{ id: "model-a" }]);
        await discoveredForProvider(provider);

        const status = getDiscoveryStatus(provider.id);
        expect(status).not.toBeNull();
        expect(status?.models).toHaveLength(1);
        expect(status?.error).toBeNull();
    });
});

describe("clearDiscoveryCache / clearDiscoveryCacheFor", () => {
    it("clearDiscoveryCache() forces every provider to re-fetch on the next lookup", async () => {
        const a = seedTestProvider();
        const b = seedTestProvider();
        providerModels.set(a.id, [{ id: "a-model" }]);
        providerModels.set(b.id, [{ id: "b-model" }]);
        await discoveredForProvider(a);
        await discoveredForProvider(b);

        clearDiscoveryCache();
        expect(getDiscoveryStatus(a.id)).toBeNull();
        expect(getDiscoveryStatus(b.id)).toBeNull();

        await discoveredForProvider(a);
        await discoveredForProvider(b);
        expect(fetchCallCounts.get(a.id)).toBe(2);
        expect(fetchCallCounts.get(b.id)).toBe(2);
    });

    it("clearDiscoveryCacheFor() only evicts the targeted provider", async () => {
        const a = seedTestProvider();
        const b = seedTestProvider();
        providerModels.set(a.id, [{ id: "a-model" }]);
        providerModels.set(b.id, [{ id: "b-model" }]);
        await discoveredForProvider(a);
        await discoveredForProvider(b);

        clearDiscoveryCacheFor(a.id);
        expect(getDiscoveryStatus(a.id)).toBeNull();
        expect(getDiscoveryStatus(b.id)).not.toBeNull(); // untouched

        await discoveredForProvider(a);
        await discoveredForProvider(b);
        expect(fetchCallCounts.get(a.id)).toBe(2); // re-fetched
        expect(fetchCallCounts.get(b.id)).toBe(1); // still the original cached fetch
    });
});

describe("discoveredCountForProvider / discoveredCountByProvider / listAllDiscovered", () => {
    it("discoveredCountForProvider short-circuits to 0 for a disabled provider (no fetch at all)", async () => {
        const provider = seedTestProvider({ enabled: false });
        providerModels.set(provider.id, [{ id: "model-a" }]);
        const count = await discoveredCountForProvider(provider);
        expect(count).toBe(0);
        expect(fetchCallCounts.get(provider.id)).toBeUndefined();
    });

    it("discoveredCountForProvider counts the discovered models for an enabled provider", async () => {
        const provider = seedTestProvider();
        providerModels.set(provider.id, [{ id: "a" }, { id: "b" }, { id: "c" }]);
        const count = await discoveredCountForProvider(provider);
        expect(count).toBe(3);
    });

    it("discoveredCountByProvider maps every enabled provider to its model count", async () => {
        const a = seedTestProvider();
        const b = seedTestProvider();
        const disabled = seedTestProvider({ enabled: false });
        providerModels.set(a.id, [{ id: "a1" }, { id: "a2" }]);
        providerModels.set(b.id, [{ id: "b1" }]);
        providerModels.set(disabled.id, [{ id: "hidden" }]);

        const counts = await discoveredCountByProvider();
        expect(counts[a.id]).toBe(2);
        expect(counts[b.id]).toBe(1);
        expect(counts[disabled.id]).toBeUndefined();
    });

    it("listAllDiscovered returns the union of every enabled provider's models", async () => {
        const a = seedTestProvider();
        const b = seedTestProvider();
        providerModels.set(a.id, [{ id: "a1" }]);
        providerModels.set(b.id, [{ id: "b1" }, { id: "b2" }]);
        extractMetaImpl = (raw) => baseMeta({ upstream_id: (raw as { id: string }).id });

        const all = await listAllDiscovered();
        expect(all.map((m) => m.id).sort()).toEqual(["a1", "b1", "b2"]);
    });

    it("listAllDiscovered supports { force: true } to bypass a fresh cache", async () => {
        const provider = seedTestProvider();
        providerModels.set(provider.id, [{ id: "model-a" }]);
        await discoveredForProvider(provider); // populates the cache
        await listAllDiscovered({ force: true });
        expect(fetchCallCounts.get(provider.id)).toBe(2);
    });
});
