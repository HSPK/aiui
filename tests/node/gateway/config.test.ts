// Tests for lib/server/config.ts — loadConfigFile(): the config-file ->
// DB provider upsert logic (adapter auto-detection, "only overwrite when
// specified" secret guard, additive/declarative behaviour, duplicate-name
// handling, and the module-level one-shot `loaded` guard).
//
// `preflightFromConfig` (lib/preflight.ts) is mocked so each test controls
// exactly what "config file" content is seen without touching the real
// filesystem or environment. `loadConfigFile` is the ONLY export — the
// interesting internals (`adapterIdFor`, `upsertProvider`) are private, so
// they are exercised indirectly through `loadConfigFile`'s DB side effects.
//
// `loaded` is a module-level "already ran" flag (mirrors bootstrapAdmin's
// `bootstrapped` / init's `ensureInit` pattern elsewhere in this repo), so
// every test gets a fresh module instance via vi.resetModules() + dynamic
// import — except the dedicated guard test, which deliberately reuses one
// instance across two calls.
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/server/db";
import { decryptSecret, encryptSecret } from "@/lib/server/crypto";
import { registerAdapter, resolveAdapter, type ProviderAdapter } from "@/lib/server/adapters";
import { resetDb, seedProvider } from "@/tests/helpers/db";
import type { Provider } from "@/lib/server/db/schema";
import type { PreflightResult } from "@/lib/preflight";

vi.mock("@/lib/preflight", () => ({
    preflightFromConfig: vi.fn(),
}));

import { preflightFromConfig } from "@/lib/preflight";

async function freshLoadConfigFile() {
    vi.resetModules();
    const { loadConfigFile } = await import("@/lib/server/config");
    return loadConfigFile;
}

function mockPreflight(result: PreflightResult) {
    vi.mocked(preflightFromConfig).mockReturnValue(result);
}

/** Real config-file YAML/JSON is parsed and cast straight to `LoomConfig`
 *  WITHOUT zod validation (see lib/preflight.ts's `parseConfigFile`'s
 *  `as LoomConfig`), so `cfg.providers[]` entries can be missing fields
 *  the *type* claims are required (e.g. `name`, `base_url`) — exactly the
 *  malformed-but-realistic shapes `upsertProvider`'s own defensive guards
 *  exist to catch. This helper builds such entries without fighting that
 *  aspirational-but-unenforced type. */
function malformedCfg(providers: Array<Record<string, unknown>>): PreflightResult["cfg"] {
    return { providers } as unknown as PreflightResult["cfg"];
}

/** Minimal Provider fixture for `resolveAdapter()` — only `adapterId` and
 *  `baseUrl` are ever read by adapter `matches()` implementations, so a
 *  full DB-shaped row isn't needed (mirrors merge-params.test.ts's
 *  fakeProvider pattern for testing a near-pure function in isolation). */
function fakeProviderWithBaseUrl(baseUrl: string, adapterId = ""): Provider {
    return { adapterId, baseUrl } as unknown as Provider;
}

// Two throwaway adapters registered directly against the module instance
// this file's top-level `import { registerAdapter, resolveAdapter } from
// "@/lib/server/adapters"` resolves to (a fresh instance private to this
// test file, untouched by any `vi.resetModules()` calls elsewhere in this
// file — those only affect *subsequent* dynamic imports, never an already-
// bound top-level static import). Neither of these hosts collides with any
// base_url used elsewhere in this file. Mirrors discovery.test.ts's
// self-contained `testAdapter` pattern.
const fallbackTestAdapter: ProviderAdapter = {
    id: "test-fallback-adapter",
    label: "Test fallback adapter",
    matches: () => true, // unconditional catch-all, just like openai's
    fallback: true,
    fetchModels: async () => [],
    extractModelMeta: () => null,
    upstreamUrl: () => "https://example.test/fallback",
    upstreamHeaders: () => ({}),
};
const specificTestAdapter: ProviderAdapter = {
    id: "test-specific-adapter",
    label: "Test specific adapter",
    matches: (provider) => provider.baseUrl.includes("my-specific-test-adapter.internal"),
    fetchModels: async () => [],
    extractModelMeta: () => null,
    upstreamUrl: () => "https://example.test/specific",
    upstreamHeaders: () => ({}),
};
registerAdapter(fallbackTestAdapter);
registerAdapter(specificTestAdapter);

function providerRow(name: string) {
    return db.select().from(schema.providers).where(eq(schema.providers.name, name)).get();
}

function providerRowsNamed(name: string) {
    return db.select().from(schema.providers).where(eq(schema.providers.name, name)).all();
}

function allProviders() {
    return db.select().from(schema.providers).all();
}

// `ReturnType<typeof vi.spyOn>` doesn't resolve usefully here — spyOn's
// last overload return type is a conditional type over its own unbound
// generic params, so without call-site inference it degrades in a way
// that loses `.mock.calls`' element typing. Console methods are all
// `(...args: any[]) => void`, so pin that down explicitly instead.
let logSpy: MockInstance<(...args: any[]) => void>;
let warnSpy: MockInstance<(...args: any[]) => void>;
let errorSpy: MockInstance<(...args: any[]) => void>;

beforeEach(() => {
    resetDb();
    vi.mocked(preflightFromConfig).mockReset();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe("lib/server/config: loadConfigFile — top-level no-op paths", () => {
    it("no config file located (path/cfg null) -> complete no-op, no DB writes, no logging", async () => {
        mockPreflight({ path: null, cfg: null, applied: [] });
        const loadConfigFile = await freshLoadConfigFile();

        loadConfigFile();

        expect(allProviders()).toHaveLength(0);
        expect(logSpy).not.toHaveBeenCalled();
        expect(warnSpy).not.toHaveBeenCalled();
        expect(errorSpy).not.toHaveBeenCalled();
    });

    it("path resolved but cfg null (upstream parse failure) -> no-op, no crash", async () => {
        mockPreflight({ path: "/etc/loom/loom.config.yaml", cfg: null, applied: [] });
        const loadConfigFile = await freshLoadConfigFile();

        loadConfigFile();

        expect(allProviders()).toHaveLength(0);
        expect(logSpy).not.toHaveBeenCalled();
    });

    it("config found with no providers key at all -> logs load message but performs no upserts", async () => {
        mockPreflight({ path: "/x/loom.config.yaml", cfg: {}, applied: [] });
        const loadConfigFile = await freshLoadConfigFile();

        loadConfigFile();

        expect(allProviders()).toHaveLength(0);
        expect(logSpy).toHaveBeenCalledWith("[loom:config] /x/loom.config.yaml loaded.");
    });

    it("providers is present but an empty array -> same as missing, no upserts", async () => {
        mockPreflight({ path: "/x/loom.config.yaml", cfg: { providers: [] }, applied: [] });
        const loadConfigFile = await freshLoadConfigFile();

        loadConfigFile();

        expect(allProviders()).toHaveLength(0);
    });

    it("providers is present but not an array -> treated as empty, no crash", async () => {
        mockPreflight({
            path: "/x/loom.config.yaml",
            cfg: { providers: "not-an-array" } as never,
            applied: [],
        });
        const loadConfigFile = await freshLoadConfigFile();

        loadConfigFile();

        expect(allProviders()).toHaveLength(0);
    });
});

describe("lib/server/config: loadConfigFile — env-applied logging branch", () => {
    it("applied.length > 0 -> logs the 'applied env from config' variant with joined names", async () => {
        mockPreflight({
            path: "/x/loom.config.yaml",
            cfg: {},
            applied: ["LOOM_MASTER_KEY", "LOOM_SERVER_PORT"],
        });
        const loadConfigFile = await freshLoadConfigFile();

        loadConfigFile();

        expect(logSpy).toHaveBeenCalledWith(
            "[loom:config] /x/loom.config.yaml: applied env from config (LOOM_MASTER_KEY, LOOM_SERVER_PORT).",
        );
    });

    it("applied.length === 0 -> logs the plain 'loaded.' variant", async () => {
        mockPreflight({ path: "/x/loom.config.yaml", cfg: {}, applied: [] });
        const loadConfigFile = await freshLoadConfigFile();

        loadConfigFile();

        expect(logSpy).toHaveBeenCalledWith("[loom:config] /x/loom.config.yaml loaded.");
    });
});

describe("lib/server/config: loadConfigFile — deprecated `models:` warning", () => {
    it("cfg.models is an array -> warns about the deprecated section", async () => {
        mockPreflight({ path: "/x/loom.config.yaml", cfg: { models: [] } as never, applied: [] });
        const loadConfigFile = await freshLoadConfigFile();

        loadConfigFile();

        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy.mock.calls[0][0]).toContain("`models:` section is deprecated");
    });

    it("cfg.models is absent -> no deprecation warning", async () => {
        mockPreflight({ path: "/x/loom.config.yaml", cfg: {}, applied: [] });
        const loadConfigFile = await freshLoadConfigFile();

        loadConfigFile();

        expect(warnSpy).not.toHaveBeenCalled();
    });

    it("cfg.models present but not an array -> guarded by Array.isArray, no warning", async () => {
        mockPreflight({ path: "/x/loom.config.yaml", cfg: { models: { foo: "bar" } } as never, applied: [] });
        const loadConfigFile = await freshLoadConfigFile();

        loadConfigFile();

        expect(warnSpy).not.toHaveBeenCalled();
    });
});

describe("lib/server/config: loadConfigFile — one-shot `loaded` guard", () => {
    it("a second call within the same module instance is a true no-op", async () => {
        mockPreflight({
            path: "/x/loom.config.yaml",
            cfg: { providers: [{ name: "p1", base_url: "https://api.example.com" }] },
            applied: [],
        });
        const loadConfigFile = await freshLoadConfigFile();

        loadConfigFile();
        expect(allProviders()).toHaveLength(1);
        expect(preflightFromConfig).toHaveBeenCalledTimes(1);

        // Second call in the same module instance: if the `loaded` guard
        // didn't short-circuit, this would re-run preflightFromConfig and
        // re-upsert "p1" (harmless here since upsert is idempotent by
        // name, but the call counts below prove the guard fired at all).
        loadConfigFile();

        expect(preflightFromConfig).toHaveBeenCalledTimes(1);
        expect(allProviders()).toHaveLength(1);
        expect(logSpy.mock.calls.filter((c) => String(c[0]).includes("upserted")).length).toBe(1);
    });
});

describe("lib/server/config: loadConfigFile — upsertProvider validation guards", () => {
    it("entry with no name -> warns and is skipped (not counted)", async () => {
        mockPreflight({
            path: "/x/loom.config.yaml",
            cfg: malformedCfg([{ base_url: "https://api.example.com" }]),
            applied: [],
        });
        const loadConfigFile = await freshLoadConfigFile();

        loadConfigFile();

        expect(allProviders()).toHaveLength(0);
        expect(warnSpy).toHaveBeenCalledWith("[loom:config] skipping provider with no name");
        expect(logSpy.mock.calls.some((c) => String(c[0]).includes("upserted"))).toBe(false);
    });

    it("whitespace-only name is treated as missing (trimmed to falsy)", async () => {
        mockPreflight({
            path: "/x/loom.config.yaml",
            cfg: { providers: [{ name: "   ", base_url: "https://api.example.com" }] },
            applied: [],
        });
        const loadConfigFile = await freshLoadConfigFile();

        loadConfigFile();

        expect(allProviders()).toHaveLength(0);
        expect(warnSpy).toHaveBeenCalledWith("[loom:config] skipping provider with no name");
    });

    it("entry with a name but no base_url -> warns (naming the provider) and is skipped", async () => {
        mockPreflight({
            path: "/x/loom.config.yaml",
            cfg: malformedCfg([{ name: "no-url-provider" }]),
            applied: [],
        });
        const loadConfigFile = await freshLoadConfigFile();

        loadConfigFile();

        expect(allProviders()).toHaveLength(0);
        expect(warnSpy).toHaveBeenCalledWith('[loom:config] provider "no-url-provider" missing base_url; skipping');
    });

    it("whitespace-only base_url is treated as missing", async () => {
        mockPreflight({
            path: "/x/loom.config.yaml",
            cfg: { providers: [{ name: "p", base_url: "   " }] },
            applied: [],
        });
        const loadConfigFile = await freshLoadConfigFile();

        loadConfigFile();

        expect(allProviders()).toHaveLength(0);
    });
});

describe("lib/server/config: adapterIdFor — auto-detection via base_url", () => {
    it("explicit adapter_id wins even when base_url would auto-detect differently", async () => {
        mockPreflight({
            path: "/x",
            cfg: {
                providers: [
                    { name: "p", base_url: "https://foo.openai.azure.com", adapter_id: "openai" },
                ],
            },
            applied: [],
        });
        const loadConfigFile = await freshLoadConfigFile();

        loadConfigFile();

        expect(providerRow("p")?.adapterId).toBe("openai");
    });

    it("explicit adapter_id is trimmed", async () => {
        mockPreflight({
            path: "/x",
            cfg: {
                providers: [{ name: "p", base_url: "https://api.example.com", adapter_id: "  openai  " }],
            },
            applied: [],
        });
        const loadConfigFile = await freshLoadConfigFile();

        loadConfigFile();

        expect(providerRow("p")?.adapterId).toBe("openai");
    });

    it("whitespace-only adapter_id falls through to auto-detection", async () => {
        mockPreflight({
            path: "/x",
            cfg: {
                providers: [{ name: "p", base_url: "https://api.example.com", adapter_id: "   " }],
            },
            applied: [],
        });
        const loadConfigFile = await freshLoadConfigFile();

        loadConfigFile();

        // Generic base_url -> falls through the azure matchers to the
        // openai catch-all.
        expect(providerRow("p")?.adapterId).toBe("openai");
    });

    // Regression coverage for the fix at lib/server/adapters/index.ts:157-173
    // (`resolveAdapter`). Auto-detection used to silently regress to the
    // "openai" catch-all for every provider — including Azure ones — because
    // `azure-foundry.ts`'s VALUE import of `./openai` transitively ran
    // `openai.ts`'s module body (and its `registerAdapter(openAIAdapter)` side
    // effect) before `azure-foundry.ts`'s own registration, reordering the
    // registry regardless of `register.ts`'s intended import order. The fix
    // does NOT rely on import/registration order at all: `openai.ts` now
    // flags itself `fallback: true`, and `resolveAdapter()`'s probing loop
    // explicitly skips `fallback`-flagged adapters (index.ts:163-166) so a
    // specific adapter's `matches()` always gets first refusal; only when
    // nothing specific matches does it fall back to `byId.get("openai")`
    // (index.ts:168), which is a direct map lookup and thus also order-
    // independent. These two tests assert the correct auto-detection
    // behaviour for Azure OpenAI and Azure Foundry shaped base_urls.
    it("no adapter_id + azure-openai-shaped base_url -> auto-detects azure-openai", async () => {
        mockPreflight({
            path: "/x",
            cfg: { providers: [{ name: "p", base_url: "https://my-resource.openai.azure.com" }] },
            applied: [],
        });
        const loadConfigFile = await freshLoadConfigFile();

        loadConfigFile();

        expect(providerRow("p")?.adapterId).toBe("azure-openai");
    });

    it("no adapter_id + azure-foundry-shaped base_url (.inference.ai.azure.com) -> auto-detects azure-foundry", async () => {
        mockPreflight({
            path: "/x",
            cfg: { providers: [{ name: "p", base_url: "https://my-project.inference.ai.azure.com" }] },
            applied: [],
        });
        const loadConfigFile = await freshLoadConfigFile();

        loadConfigFile();

        expect(providerRow("p")?.adapterId).toBe("azure-foundry");
    });

    it("no adapter_id + azure-foundry-shaped base_url (.services.ai.azure.com) -> auto-detects azure-foundry", async () => {
        mockPreflight({
            path: "/x",
            cfg: { providers: [{ name: "p", base_url: "https://my-project.services.ai.azure.com" }] },
            applied: [],
        });
        const loadConfigFile = await freshLoadConfigFile();

        loadConfigFile();

        expect(providerRow("p")?.adapterId).toBe("azure-foundry");
    });

    it("no adapter_id + generic/unrecognized base_url -> falls back to the openai catch-all", async () => {
        mockPreflight({
            path: "/x",
            cfg: { providers: [{ name: "p", base_url: "https://api.example.com/v1" }] },
            applied: [],
        });
        const loadConfigFile = await freshLoadConfigFile();

        loadConfigFile();

        expect(providerRow("p")?.adapterId).toBe("openai");
    });

    it("no adapter_id + unparseable base_url -> matches() throws internally and is caught, still falls back to openai", async () => {
        mockPreflight({
            path: "/x",
            cfg: { providers: [{ name: "p", base_url: "not a url" }] },
            applied: [],
        });
        const loadConfigFile = await freshLoadConfigFile();

        loadConfigFile();

        expect(providerRow("p")?.adapterId).toBe("openai");
    });
});

describe("lib/server/adapters: resolveAdapter — order independence & fallback semantics (regression)", () => {
    it("auto-detection is correct no matter which order the adapter modules happen to import/register in", async () => {
        vi.resetModules();
        // Deliberately import in the "wrong" order — the openai catch-all
        // FIRST, then the two Azure adapters. Before the `fallback` flag
        // fix (lib/server/adapters/index.ts:157-173), whichever adapter
        // ended up first in the registry array unconditionally won the
        // probe, so registering openai first used to make every provider
        // resolve to plain "openai" — exactly the failure mode that a
        // stray value import (azure-foundry.ts importing from ./openai)
        // used to trigger. `register.ts` still imports azure-foundry ->
        // azure-openai -> openai (see its own comment), but this test
        // proves the *outcome* no longer depends on that order at all.
        await import("@/lib/server/adapters/openai");
        await import("@/lib/server/adapters/azure-openai");
        await import("@/lib/server/adapters/azure-foundry");
        const { resolveAdapter: freshResolveAdapter } = await import("@/lib/server/adapters");

        const cases: Array<[baseUrl: string, expectedAdapterId: string]> = [
            ["https://api.example.com/v1", "openai"],
            ["https://my-resource.openai.azure.com", "azure-openai"],
            ["https://my-project.inference.ai.azure.com", "azure-foundry"],
            ["https://my-project.services.ai.azure.com", "azure-foundry"],
        ];
        for (const [baseUrl, expectedAdapterId] of cases) {
            expect(freshResolveAdapter(fakeProviderWithBaseUrl(baseUrl)).id).toBe(expectedAdapterId);
        }
    });

    it("a fallback-flagged adapter never wins the probe when a specific adapter also matches", () => {
        // `fallbackTestAdapter.matches()` unconditionally returns true —
        // exactly like openai's `() => true` — so if `resolveAdapter`
        // walked the registry in plain array order without skipping
        // `fallback`-flagged entries, this would resolve to the fallback
        // (registered first, above). It must resolve to the specific
        // adapter instead, proving the `fallback` flag (not registration
        // order, and not matches() selectivity) is what's authoritative.
        const provider = fakeProviderWithBaseUrl("https://my-specific-test-adapter.internal");
        expect(resolveAdapter(provider).id).toBe("test-specific-adapter");
    });
});

describe("lib/server/config: upsertProvider — new provider (insert path)", () => {
    it("creates a full row with all fields correctly mapped, including an encryptable api_key", async () => {
        mockPreflight({
            path: "/x",
            cfg: {
                providers: [
                    {
                        name: "new-provider",
                        base_url: "https://api.example.com/v1",
                        api_key: "sk-secret-123",
                        api_version: "2024-01-01",
                        default_params: { temperature: 0.5 },
                        document_page: "https://docs.example.com",
                        model_page: "https://models.example.com",
                        health_check_url: "https://api.example.com/health",
                        is_local: true,
                        enabled: false,
                    },
                ],
            },
            applied: [],
        });
        const loadConfigFile = await freshLoadConfigFile();

        loadConfigFile();

        const row = providerRow("new-provider");
        expect(row).toBeTruthy();
        expect(row!.baseUrl).toBe("https://api.example.com/v1");
        expect(row!.apiVersion).toBe("2024-01-01");
        expect(row!.defaultParams).toEqual({ temperature: 0.5 });
        expect(row!.documentPage).toBe("https://docs.example.com");
        expect(row!.modelPage).toBe("https://models.example.com");
        expect(row!.healthCheckUrl).toBe("https://api.example.com/health");
        expect(row!.isLocal).toBe(true);
        expect(row!.enabled).toBe(false);
        expect(decryptSecret(row!.apiKeyEncrypted)).toBe("sk-secret-123");
        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("upserted 1 provider(s)"));
    });

    it("omitting optional fields uses the documented defaults", async () => {
        mockPreflight({
            path: "/x",
            cfg: { providers: [{ name: "bare", base_url: "https://api.example.com" }] },
            applied: [],
        });
        const loadConfigFile = await freshLoadConfigFile();

        loadConfigFile();

        const row = providerRow("bare");
        expect(row!.apiVersion).toBeNull();
        expect(row!.apiKeyEncrypted).toBeNull();
        expect(row!.defaultParams).toEqual({});
        expect(row!.documentPage).toBeNull();
        expect(row!.modelPage).toBeNull();
        expect(row!.healthCheckUrl).toBeNull();
        expect(row!.isLocal).toBe(false);
        expect(row!.enabled).toBe(true);
    });

    it("a whitespace-only api_key on a brand-new provider is treated as absent (no secret stored)", async () => {
        mockPreflight({
            path: "/x",
            cfg: { providers: [{ name: "bare", base_url: "https://api.example.com", api_key: "   " }] },
            applied: [],
        });
        const loadConfigFile = await freshLoadConfigFile();

        loadConfigFile();

        expect(providerRow("bare")?.apiKeyEncrypted).toBeNull();
    });
});

describe("lib/server/config: upsertProvider — existing provider (update path), api_key guard", () => {
    it("entry omitting api_key entirely -> preserves the existing encrypted secret while other fields still update", async () => {
        seedProvider({ name: "existing", baseUrl: "https://old.example.com", apiKeyEncrypted: encryptSecret("original-secret") });
        mockPreflight({
            path: "/x",
            cfg: { providers: [{ name: "existing", base_url: "https://updated.example.com" }] },
            applied: [],
        });
        const loadConfigFile = await freshLoadConfigFile();

        loadConfigFile();

        const row = providerRow("existing")!;
        expect(row.baseUrl).toBe("https://updated.example.com");
        expect(decryptSecret(row.apiKeyEncrypted)).toBe("original-secret");
    });

    it("entry with api_key: null explicitly -> wipes the existing secret", async () => {
        seedProvider({ name: "existing", apiKeyEncrypted: encryptSecret("original-secret") });
        mockPreflight({
            path: "/x",
            cfg: { providers: [{ name: "existing", base_url: "https://api.example.com", api_key: null }] },
            applied: [],
        });
        const loadConfigFile = await freshLoadConfigFile();

        loadConfigFile();

        expect(providerRow("existing")?.apiKeyEncrypted).toBeNull();
    });

    it("entry with a new api_key string -> updates the encrypted secret", async () => {
        seedProvider({ name: "existing", apiKeyEncrypted: encryptSecret("original-secret") });
        mockPreflight({
            path: "/x",
            cfg: { providers: [{ name: "existing", base_url: "https://api.example.com", api_key: "new-secret" }] },
            applied: [],
        });
        const loadConfigFile = await freshLoadConfigFile();

        loadConfigFile();

        expect(decryptSecret(providerRow("existing")?.apiKeyEncrypted)).toBe("new-secret");
    });

    it("entry with a whitespace-only api_key -> treated as specified-but-empty, wipes the secret", async () => {
        seedProvider({ name: "existing", apiKeyEncrypted: encryptSecret("original-secret") });
        mockPreflight({
            path: "/x",
            cfg: { providers: [{ name: "existing", base_url: "https://api.example.com", api_key: "   " }] },
            applied: [],
        });
        const loadConfigFile = await freshLoadConfigFile();

        loadConfigFile();

        expect(providerRow("existing")?.apiKeyEncrypted).toBeNull();
    });
});

describe("lib/server/config: upsertProvider — existing provider (update path), general fields", () => {
    it("updates base_url/api_version/default_params/document_page/model_page/health_check_url/is_local unconditionally", async () => {
        seedProvider({
            name: "existing",
            baseUrl: "https://old.example.com",
            apiVersion: "old-version",
            defaultParams: { old: true },
            documentPage: "https://old-docs.example.com",
            modelPage: "https://old-models.example.com",
            healthCheckUrl: "https://old-health.example.com",
            isLocal: false,
        });
        mockPreflight({
            path: "/x",
            cfg: {
                providers: [
                    {
                        name: "existing",
                        base_url: "https://new.example.com",
                        api_version: "new-version",
                        default_params: { fresh: true },
                        document_page: "https://new-docs.example.com",
                        model_page: "https://new-models.example.com",
                        health_check_url: "https://new-health.example.com",
                        is_local: true,
                    },
                ],
            },
            applied: [],
        });
        const loadConfigFile = await freshLoadConfigFile();

        loadConfigFile();

        const row = providerRow("existing")!;
        expect(row.baseUrl).toBe("https://new.example.com");
        expect(row.apiVersion).toBe("new-version");
        expect(row.defaultParams).toEqual({ fresh: true });
        expect(row.documentPage).toBe("https://new-docs.example.com");
        expect(row.modelPage).toBe("https://new-models.example.com");
        expect(row.healthCheckUrl).toBe("https://new-health.example.com");
        expect(row.isLocal).toBe(true);
    });

    it("omitting `enabled` on reload resets a previously-disabled provider back to enabled:true (documented default)", async () => {
        seedProvider({ name: "existing", enabled: false });
        mockPreflight({
            path: "/x",
            cfg: { providers: [{ name: "existing", base_url: "https://api.example.com" }] },
            applied: [],
        });
        const loadConfigFile = await freshLoadConfigFile();

        loadConfigFile();

        expect(providerRow("existing")?.enabled).toBe(true);
    });

    it("explicit enabled:false is honored on an update", async () => {
        seedProvider({ name: "existing", enabled: true });
        mockPreflight({
            path: "/x",
            cfg: { providers: [{ name: "existing", base_url: "https://api.example.com", enabled: false }] },
            applied: [],
        });
        const loadConfigFile = await freshLoadConfigFile();

        loadConfigFile();

        expect(providerRow("existing")?.enabled).toBe(false);
    });

    it("update path preserves the existing provider's id (no re-insert)", async () => {
        const existing = seedProvider({ name: "existing" });
        mockPreflight({
            path: "/x",
            cfg: { providers: [{ name: "existing", base_url: "https://updated.example.com" }] },
            applied: [],
        });
        const loadConfigFile = await freshLoadConfigFile();

        loadConfigFile();

        expect(providerRow("existing")?.id).toBe(existing.id);
        expect(allProviders()).toHaveLength(1);
    });
});

describe("lib/server/config: loadConfigFile — additive/declarative behaviour", () => {
    it("a DB-only provider not mentioned in the config file is left completely untouched", async () => {
        const untouched = seedProvider({ name: "db-only", baseUrl: "https://db-only.example.com", enabled: false });
        mockPreflight({
            path: "/x",
            cfg: { providers: [{ name: "other", base_url: "https://api.example.com" }] },
            applied: [],
        });
        const loadConfigFile = await freshLoadConfigFile();

        loadConfigFile();

        expect(providerRow("db-only")).toEqual(untouched);
        expect(providerRow("other")).toBeTruthy();
        expect(allProviders()).toHaveLength(2);
    });
});

describe("lib/server/config: loadConfigFile — duplicate provider names", () => {
    it("warns on duplicate names within one load; the last entry wins (name is unique in the DB)", async () => {
        mockPreflight({
            path: "/x",
            cfg: {
                providers: [
                    { name: "dup", base_url: "https://first.example.com", api_key: "first-key" },
                    { name: "dup", base_url: "https://second.example.com", api_key: "second-key" },
                ],
            },
            applied: [],
        });
        const loadConfigFile = await freshLoadConfigFile();

        loadConfigFile();

        expect(warnSpy.mock.calls.some((c) => String(c[0]).includes('duplicate provider name "dup"'))).toBe(true);
        const rows = providerRowsNamed("dup");
        expect(rows).toHaveLength(1);
        expect(rows[0].baseUrl).toBe("https://second.example.com");
        expect(decryptSecret(rows[0].apiKeyEncrypted)).toBe("second-key");
    });

    it("no warning when all names are unique", async () => {
        mockPreflight({
            path: "/x",
            cfg: {
                providers: [
                    { name: "a", base_url: "https://a.example.com" },
                    { name: "b", base_url: "https://b.example.com" },
                ],
            },
            applied: [],
        });
        const loadConfigFile = await freshLoadConfigFile();

        loadConfigFile();

        expect(warnSpy.mock.calls.some((c) => String(c[0]).includes("duplicate"))).toBe(false);
    });

    it("entries with no name don't participate in duplicate tracking (continue before Set.add)", async () => {
        mockPreflight({
            path: "/x",
            cfg: malformedCfg([
                { base_url: "https://no-name-1.example.com" },
                { base_url: "https://no-name-2.example.com" },
                { name: "b", base_url: "https://b.example.com" },
            ]),
            applied: [],
        });
        const loadConfigFile = await freshLoadConfigFile();

        loadConfigFile();

        expect(warnSpy.mock.calls.some((c) => String(c[0]).includes("duplicate"))).toBe(false);
    });
});

describe("lib/server/config: loadConfigFile — per-entry throw isolation", () => {
    it("an entry that throws during upsert is caught, logged via console.error, and does not abort subsequent entries", async () => {
        mockPreflight({
            path: "/x",
            cfg: {
                providers: [
                    { name: "bad", base_url: "https://bad.example.com" },
                    { name: "good", base_url: "https://good.example.com" },
                ],
            },
            applied: [],
        });
        const loadConfigFile = await freshLoadConfigFile();

        const insertSpy = vi.spyOn(db, "insert").mockImplementationOnce(() => {
            throw new Error("simulated DB failure");
        });
        try {
            loadConfigFile();
        } finally {
            insertSpy.mockRestore();
        }

        expect(errorSpy).toHaveBeenCalledWith(
            expect.stringContaining('upsert provider "bad" failed:'),
            expect.any(Error),
        );
        expect(providerRow("bad")).toBeUndefined();
        expect(providerRow("good")).toBeTruthy();
        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("upserted 1 provider(s)"));
    });

    it("count in the final log reflects only successful upserts when mixed with skips", async () => {
        mockPreflight({
            path: "/x",
            cfg: malformedCfg([
                { base_url: "https://no-name.example.com" },
                { name: "no-url" },
                { name: "good1", base_url: "https://good1.example.com" },
                { name: "good2", base_url: "https://good2.example.com" },
            ]),
            applied: [],
        });
        const loadConfigFile = await freshLoadConfigFile();

        loadConfigFile();

        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("upserted 2 provider(s)"));
        expect(allProviders()).toHaveLength(2);
    });
});
