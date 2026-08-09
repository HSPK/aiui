import { describe, expect, it, vi } from "vitest";
import type { ProviderAdapter } from "@/lib/server/adapters";
import type { CapabilityHandler } from "@/lib/server/capabilities";
import type { NormalizedModelMeta, UpstreamApiId } from "@/lib/schemas/adapter";
import type { UpstreamApiVariant } from "@/lib/server/api-variants";
import { makeModel, makeProvider } from "./fixtures";

/**
 * These tests exercise `lib/server/adapters/index.ts` registry mechanics
 * in full isolation: each test calls `vi.resetModules()` then dynamically
 * re-imports the adapters (and, where needed, api-variants) module so it
 * starts from a completely EMPTY registry. This lets us reach branches
 * (the post-loop fallback, the throw-when-no-openai-adapter path) that
 * are unreachable once the real built-in adapters (whose "openai" adapter
 * is an unconditional catch-all) are registered via `adapters/register`.
 */
async function freshAdaptersModule() {
    vi.resetModules();
    return import("@/lib/server/adapters");
}

async function freshAdaptersAndVariantsModules() {
    vi.resetModules();
    const variantsMod = await import("@/lib/server/api-variants");
    const adaptersMod = await import("@/lib/server/adapters");
    return { variantsMod, adaptersMod };
}

function fakeAdapter(id: string, overrides: Partial<ProviderAdapter> = {}): ProviderAdapter {
    return {
        id,
        label: id,
        matches: () => false,
        fetchModels: async () => [],
        extractModelMeta: () => null,
        upstreamUrl: () => "",
        upstreamHeaders: () => ({}),
        ...overrides,
    };
}

function fakeVariant(id: UpstreamApiId, capability: string, overrides: Partial<UpstreamApiVariant> = {}): UpstreamApiVariant {
    return {
        id,
        capability,
        path: "/x",
        supportsStreaming: false,
        parseResponse: () => ({ output: null, promptTokens: null, completionTokens: null, totalTokens: null, normalized: {} }),
        parseStreamChunk: () => null,
        ...overrides,
    };
}

describe("adapters/index — registerAdapter / getAdapter / listAdapters", () => {
    it("registers new adapters and getAdapter looks them up by id", async () => {
        const mod = await freshAdaptersModule();
        mod.registerAdapter(fakeAdapter("a"));
        mod.registerAdapter(fakeAdapter("b"));
        expect(mod.listAdapters().map((a) => a.id)).toEqual(["a", "b"]);
        expect(mod.getAdapter("a")?.label).toBe("a");
        expect(mod.getAdapter("missing")).toBeUndefined();
    });

    it("re-registering the same id replaces the entry IN PLACE, preserving registration order", async () => {
        const mod = await freshAdaptersModule();
        mod.registerAdapter(fakeAdapter("a", { label: "first" }));
        mod.registerAdapter(fakeAdapter("b", { label: "second" }));
        mod.registerAdapter(fakeAdapter("a", { label: "first-updated" }));
        expect(mod.listAdapters()).toEqual([
            { id: "a", label: "first-updated", description: undefined },
            { id: "b", label: "second", description: undefined },
        ]);
        expect(mod.getAdapter("a")?.label).toBe("first-updated");
    });

    it("listAdapters projects only {id,label,description}", async () => {
        const mod = await freshAdaptersModule();
        mod.registerAdapter(fakeAdapter("a", { label: "A", description: "desc", matches: () => true }));
        expect(mod.listAdapters()).toEqual([{ id: "a", label: "A", description: "desc" }]);
    });
});

describe("adapters/index — resolveAdapter", () => {
    it("uses provider.adapterId explicitly when registered, bypassing matches() entirely", async () => {
        const mod = await freshAdaptersModule();
        mod.registerAdapter(fakeAdapter("explicit-id", { matches: () => false }));
        mod.registerAdapter(fakeAdapter("openai", { matches: () => true }));
        const resolved = mod.resolveAdapter(makeProvider({ adapterId: "explicit-id" }));
        expect(resolved.id).toBe("explicit-id");
    });

    it("falls through to matches() scanning when provider.adapterId is set but not registered", async () => {
        const mod = await freshAdaptersModule();
        mod.registerAdapter(fakeAdapter("specific", { matches: (p) => p.baseUrl.includes("special") }));
        mod.registerAdapter(fakeAdapter("openai", { matches: () => true }));
        const resolved = mod.resolveAdapter(makeProvider({ adapterId: "nonexistent-adapter", baseUrl: "https://special.example.com" }));
        expect(resolved.id).toBe("specific");
    });

    it("scans registered adapters in registration order when no adapterId is set (first match wins)", async () => {
        const mod = await freshAdaptersModule();
        mod.registerAdapter(fakeAdapter("first", { matches: () => true }));
        mod.registerAdapter(fakeAdapter("second", { matches: () => true }));
        const resolved = mod.resolveAdapter(makeProvider({ adapterId: "" }));
        expect(resolved.id).toBe("first");
    });

    it("falls back to the 'openai'-id adapter (bypassing ITS OWN matches()) when nothing in the scan matches", async () => {
        const mod = await freshAdaptersModule();
        mod.registerAdapter(fakeAdapter("other", { matches: () => false }));
        // Deliberately give the fallback adapter a matches() that returns false —
        // proves the post-loop `byId.get("openai")` fallback doesn't re-check matches().
        mod.registerAdapter(fakeAdapter("openai", { matches: () => false }));
        const resolved = mod.resolveAdapter(makeProvider({ adapterId: "" }));
        expect(resolved.id).toBe("openai");
    });

    it("throws a descriptive error when nothing matches and no 'openai'-id adapter is registered", async () => {
        const mod = await freshAdaptersModule();
        mod.registerAdapter(fakeAdapter("other", { matches: () => false }));
        expect(() => mod.resolveAdapter(makeProvider({ adapterId: "" }))).toThrow(/No 'openai' adapter registered/);
    });

    it("throws on a totally empty registry", async () => {
        const mod = await freshAdaptersModule();
        expect(() => mod.resolveAdapter(makeProvider())).toThrow(/No 'openai' adapter registered/);
    });
});

/**
 * Regression coverage for the bug where `azure-foundry.ts`'s *value* import
 * of `./openai` made `openai.ts` (a `matches: () => true` catch-all)
 * register FIRST, so `resolveAdapter()`'s "first match wins" scan returned
 * openai for every provider — including Azure ones — since registration
 * order silently doubled as specificity order. The fix: `ProviderAdapter`
 * gained `readonly fallback?: boolean`; `resolveAdapter()`'s probe loop does
 * `if (adapter.fallback) continue;` so catch-alls never win the scan
 * regardless of when they registered, and the existing post-loop
 * `byId.get("openai")` still serves the true no-match case.
 */
describe("adapters/index — resolveAdapter: fallback flag (order-independent catch-all)", () => {
    it("a specific match registered AFTER a fallback:true catch-all still wins — the catch-all is skipped by `if (adapter.fallback) continue`", async () => {
        const mod = await freshAdaptersModule();
        mod.registerAdapter(fakeAdapter("catch-all", { matches: () => true, fallback: true }));
        mod.registerAdapter(fakeAdapter("specific", { matches: (p) => p.baseUrl.includes("special") }));
        const resolved = mod.resolveAdapter(makeProvider({ adapterId: "", baseUrl: "https://special.example.com" }));
        expect(resolved.id).toBe("specific");
    });

    it("a specific match registered BEFORE a fallback:true catch-all still wins — resolution is order-independent either way", async () => {
        const mod = await freshAdaptersModule();
        mod.registerAdapter(fakeAdapter("specific", { matches: (p) => p.baseUrl.includes("special") }));
        mod.registerAdapter(fakeAdapter("catch-all", { matches: () => true, fallback: true }));
        const resolved = mod.resolveAdapter(makeProvider({ adapterId: "", baseUrl: "https://special.example.com" }));
        expect(resolved.id).toBe("specific");
    });

    it("a fallback:true adapter (id 'openai') is still returned when nothing else matches, via the post-loop catch-all — and its matches() is never even invoked during the probe", async () => {
        const mod = await freshAdaptersModule();
        const fallbackMatches = vi.fn(() => true);
        mod.registerAdapter(fakeAdapter("other", { matches: () => false }));
        mod.registerAdapter(fakeAdapter("openai", { matches: fallbackMatches, fallback: true }));
        const resolved = mod.resolveAdapter(makeProvider({ adapterId: "" }));
        expect(resolved.id).toBe("openai");
        // Proves `continue` fires for fallback adapters BEFORE matches() would
        // ever be called — the probe loop skips them unconditionally.
        expect(fallbackMatches).not.toHaveBeenCalled();
    });

    it("listAdapters() still includes fallback-flagged adapters — the skip only applies to resolution, not listing", async () => {
        const mod = await freshAdaptersModule();
        mod.registerAdapter(fakeAdapter("specific", { matches: () => false }));
        mod.registerAdapter(fakeAdapter("catch-all", { matches: () => true, fallback: true }));
        expect(mod.listAdapters().map((a) => a.id)).toEqual(["specific", "catch-all"]);
    });
});

describe("adapters/index — resolveAdapter: real built-in adapters (import-order-independence regression)", () => {
    /** Imports the real adapter modules in the "wrong" order — `./openai`
     *  (the catch-all) FIRST, exactly the order that used to break auto-
     *  detection when `azure-foundry.ts`'s value import of `./openai`
     *  pulled it in ahead of the specific adapters. All three modules
     *  self-register via a top-level `registerAdapter(...)` call, and share
     *  the one fresh `adapters/index.ts` instance created by the first
     *  import below, so this reproduces genuine registration order — not a
     *  simulation with fake adapters. */
    async function freshRealAdaptersInWrongOrder() {
        vi.resetModules();
        await import("@/lib/server/adapters/openai");
        await import("@/lib/server/adapters/azure-foundry");
        await import("@/lib/server/adapters/azure-openai");
        return import("@/lib/server/adapters");
    }

    it.each([
        ["https://my-proj.services.ai.azure.com", "azure-foundry"],
        ["https://my-proj.inference.ai.azure.com", "azure-foundry"],
        ["https://my-res.openai.azure.com", "azure-openai"],
        ["https://api.openai.com/v1", "openai"],
    ])("auto-detects baseUrl %s as '%s' regardless of the catch-all registering first", async (baseUrl, expectedId) => {
        const mod = await freshRealAdaptersInWrongOrder();
        const resolved = mod.resolveAdapter(makeProvider({ adapterId: "", baseUrl }));
        expect(resolved.id).toBe(expectedId);
    });
});

describe("adapters/index — resolveVariantId", () => {
    const chatCapability: CapabilityHandler = {
        id: "chat",
        label: "Chat",
        defaultVariantId: "chat.completions",
        variantPreference: ["responses", "chat.completions"],
    };

    it("prefers a pinned model.apiVariantId when it serves the requested capability", async () => {
        const { variantsMod, adaptersMod } = await freshAdaptersAndVariantsModules();
        variantsMod.registerVariant(fakeVariant("chat.completions", "chat"));
        variantsMod.registerVariant(fakeVariant("responses", "chat"));
        const adapter = fakeAdapter("no-select");
        const model = makeModel({ apiVariantId: "responses" });
        expect(adaptersMod.resolveVariantId(adapter, chatCapability, model, null)).toBe("responses");
    });

    it("ignores a pinned apiVariantId that serves a DIFFERENT capability, falling through", async () => {
        const { variantsMod, adaptersMod } = await freshAdaptersAndVariantsModules();
        variantsMod.registerVariant(fakeVariant("chat.completions", "chat"));
        variantsMod.registerVariant(fakeVariant("embeddings", "embedding"));
        const adapter = fakeAdapter("no-select");
        const model = makeModel({ apiVariantId: "embeddings" }); // embeddings variant doesn't serve "chat"
        expect(adaptersMod.resolveVariantId(adapter, chatCapability, model, null)).toBe("chat.completions");
    });

    it("ignores a pinned apiVariantId that isn't a registered variant at all", async () => {
        const { variantsMod, adaptersMod } = await freshAdaptersAndVariantsModules();
        variantsMod.registerVariant(fakeVariant("chat.completions", "chat"));
        const adapter = fakeAdapter("no-select");
        const model = makeModel({ apiVariantId: "totally-made-up-id" });
        expect(adaptersMod.resolveVariantId(adapter, chatCapability, model, null)).toBe("chat.completions");
    });

    it("uses adapter.selectVariant when defined and no pin applies", async () => {
        const { variantsMod, adaptersMod } = await freshAdaptersAndVariantsModules();
        variantsMod.registerVariant(fakeVariant("chat.completions", "chat"));
        variantsMod.registerVariant(fakeVariant("responses", "chat"));
        const adapter = fakeAdapter("custom", { selectVariant: () => "responses" });
        const model = makeModel({ apiVariantId: null });
        expect(adaptersMod.resolveVariantId(adapter, chatCapability, model, null)).toBe("responses");
    });

    it("falls back to defaultSelectVariantId (capability preference ∩ meta.supported_apis) with no pin and no adapter.selectVariant", async () => {
        const { variantsMod, adaptersMod } = await freshAdaptersAndVariantsModules();
        variantsMod.registerVariant(fakeVariant("chat.completions", "chat"));
        variantsMod.registerVariant(fakeVariant("responses", "chat"));
        const adapter = fakeAdapter("no-select");
        const model = makeModel({ apiVariantId: null });
        const meta: NormalizedModelMeta = { upstream_id: "x", supported_apis: ["responses", "chat.completions"], capabilities: {} };
        expect(adaptersMod.resolveVariantId(adapter, chatCapability, model, meta)).toBe("responses");
    });

    it("adapter.selectVariant takes priority over the default selector even when a pin is absent", async () => {
        const { variantsMod, adaptersMod } = await freshAdaptersAndVariantsModules();
        variantsMod.registerVariant(fakeVariant("chat.completions", "chat"));
        const adapter = fakeAdapter("custom", { selectVariant: () => "chat.completions" });
        const model = makeModel({ apiVariantId: null });
        const meta: NormalizedModelMeta = { upstream_id: "x", supported_apis: ["chat.completions"], capabilities: {} };
        const spy = vi.fn(adapter.selectVariant!);
        adapter.selectVariant = spy;
        adaptersMod.resolveVariantId(adapter, chatCapability, model, meta);
        expect(spy).toHaveBeenCalledWith(chatCapability, model, meta);
    });
});
