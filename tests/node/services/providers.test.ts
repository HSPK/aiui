import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/server/db";
import { HttpError } from "@/lib/server/response";
import { decryptSecret } from "@/lib/server/crypto";
import { getDiscoveryStatus } from "@/lib/server/discovery";
import {
    checkProvider,
    createProvider,
    deleteProvider,
    findProviderByIdOrName,
    getProvider,
    listProviders,
    loadProviderApiKey,
    probeHealthCheckUrl,
    updateProvider,
} from "@/lib/server/providers";
import { resetDb, seedModel, seedProvider } from "../../helpers/db";

/** Default upstream `/models`-shaped response — enough for every adapter's
 *  `fetchModels` (openai + azure-foundry share `fetchOpenAIModels`; azure-openai
 *  has its own but reads the same `{data:[...]}` envelope). */
function stubFetch(impl?: (url: string, init?: RequestInit) => unknown) {
    const fn = vi.fn(
        impl ?? (() => Promise.resolve({ ok: true, json: async () => ({ data: [] }) })),
    );
    vi.stubGlobal("fetch", fn);
    return fn;
}

async function expectHttpError(fn: () => unknown, status: number): Promise<HttpError> {
    try {
        await fn();
    } catch (err) {
        expect(err).toBeInstanceOf(HttpError);
        expect((err as HttpError).status).toBe(status);
        return err as HttpError;
    }
    throw new Error("expected fn() to throw");
}

describe("providers service", () => {
    beforeEach(() => {
        resetDb();
        stubFetch();
    });

    describe("findProviderByIdOrName", () => {
        it("finds by id", () => {
            const p = seedProvider({ name: "by-id" });
            expect(findProviderByIdOrName(p.id)?.id).toBe(p.id);
        });

        it("finds by name", () => {
            const p = seedProvider({ name: "by-name" });
            expect(findProviderByIdOrName("by-name")?.id).toBe(p.id);
        });

        it("returns undefined when neither id nor name matches", () => {
            expect(findProviderByIdOrName("nope")).toBeUndefined();
        });
    });

    describe("loadProviderApiKey", () => {
        it("decrypts the stored ciphertext back to the original plaintext", () => {
            const p = seedProvider({ apiKeyEncrypted: undefined });
            // seedProvider's default already encrypts "sk-test-upstream-key".
            expect(loadProviderApiKey(p)).toBe("sk-test-upstream-key");
        });

        it("returns null when no key is stored", () => {
            const p = seedProvider({ apiKeyEncrypted: null });
            expect(loadProviderApiKey(p)).toBeNull();
        });
    });

    describe("listProviders", () => {
        it("returns [] when there are none", async () => {
            expect(await listProviders()).toEqual([]);
        });

        it("orders by name and reports has_api_key + n_models (db + discovered)", async () => {
            stubFetch(() => Promise.resolve({ ok: true, json: async () => ({ data: [{ id: "up-1" }, { id: "up-2" }] }) }));
            const zeta = seedProvider({ name: "zeta", apiKeyEncrypted: null });
            const alpha = seedProvider({ name: "alpha" });
            seedModel({ providerId: alpha.id, name: "alpha/db-model" });

            const rows = await listProviders();
            expect(rows.map((r) => r.name)).toEqual(["alpha", "zeta"]);

            const alphaDto = rows.find((r) => r.id === alpha.id)!;
            expect(alphaDto.has_api_key).toBe(true);
            expect(alphaDto.n_models).toBe(1 + 2); // 1 db-row model + 2 discovered

            const zetaDto = rows.find((r) => r.id === zeta.id)!;
            expect(zetaDto.has_api_key).toBe(false);
            expect(zetaDto.n_models).toBe(0 + 2);
        });

        it("does not count models for a disabled provider (discovery short-circuits)", async () => {
            const fetchSpy = stubFetch();
            seedProvider({ name: "disabled-one", enabled: false });
            const rows = await listProviders();
            expect(rows[0].n_models).toBe(0);
            expect(fetchSpy).not.toHaveBeenCalled();
        });
    });

    describe("getProvider", () => {
        it("throws 404 when missing", async () => {
            await expectHttpError(() => getProvider("nope"), 404);
        });

        it("resolves by id or by name and serializes DTO fields", async () => {
            const p = seedProvider({
                name: "acme",
                baseUrl: "https://api.acme.test/v1",
                documentPage: "https://docs.acme.test",
                modelPage: "https://models.acme.test",
            });
            const byId = await getProvider(p.id);
            const byName = await getProvider("acme");
            expect(byId).toEqual(byName);
            expect(byId).toMatchObject({
                id: p.id,
                name: "acme",
                provider_name: "acme",
                base_url: "https://api.acme.test/v1",
                proxy: "https://api.acme.test/v1",
                document_page: "https://docs.acme.test",
                model_page: "https://models.acme.test",
                enabled: true,
                is_local: false,
            });
        });
    });

    describe("createProvider", () => {
        it("creates with sane defaults when optional fields are omitted", async () => {
            const dto = await createProvider({ name: "minimal", base_url: "https://api.example.com/v1" });
            expect(dto.name).toBe("minimal");
            expect(dto.provider_name).toBe("minimal");
            expect(dto.adapter_id).toBe("openai");
            expect(dto.api_version).toBeNull();
            expect(dto.has_api_key).toBe(false);
            expect(dto.default_params).toEqual({});
            expect(dto.document_page).toBe("");
            expect(dto.model_page).toBe("");
            expect(dto.health_check_url).toBeNull();
            expect(dto.is_local).toBe(false);
            expect(dto.enabled).toBe(true);
            expect(dto.id).toEqual(expect.any(String));
            expect(dto.created_at).toEqual(expect.any(String));
        });

        it("trims name/base_url/health_check_url and stores document/model pages", async () => {
            const dto = await createProvider({
                name: "  padded  ",
                base_url: "  https://api.example.com/v1  ",
                health_check_url: "  https://api.example.com/health  ",
                document_page: "https://docs.example.com",
                model_page: "https://models.example.com",
            });
            expect(dto.name).toBe("padded");
            expect(dto.base_url).toBe("https://api.example.com/v1");
            expect(dto.health_check_url).toBe("https://api.example.com/health");
            expect(dto.document_page).toBe("https://docs.example.com");
            expect(dto.model_page).toBe("https://models.example.com");
        });

        it("rejects a duplicate provider name with 400", async () => {
            await createProvider({ name: "dup", base_url: "https://api.example.com/v1" });
            const err = await expectHttpError(
                () => createProvider({ name: "dup", base_url: "https://api.other.com/v1" }),
                400,
            );
            expect(err.message).toMatch(/already exists/i);
        });

        it("stores default_params, is_local and enabled overrides verbatim", async () => {
            const dto = await createProvider({
                name: "custom-flags",
                base_url: "https://api.example.com/v1",
                default_params: { temperature: 0.5 },
                is_local: true,
                enabled: false,
            });
            expect(dto.default_params).toEqual({ temperature: 0.5 });
            expect(dto.is_local).toBe(true);
            expect(dto.enabled).toBe(false);
        });

        describe("API-key encryption at rest", () => {
            it("never stores the plaintext api_key in the database", async () => {
                const dto = await createProvider({
                    name: "secret-holder",
                    base_url: "https://api.example.com/v1",
                    api_key: "sk-super-secret-plaintext",
                });
                expect(dto.has_api_key).toBe(true);

                const row = db.select().from(schema.providers).where(eq(schema.providers.id, dto.id)).get()!;
                expect(row.apiKeyEncrypted).not.toBeNull();
                expect(row.apiKeyEncrypted).not.toContain("sk-super-secret-plaintext");
                expect(row.apiKeyEncrypted).not.toBe("sk-super-secret-plaintext");

                // ...but it round-trips back to the original via the app's own decrypt path.
                expect(decryptSecret(row.apiKeyEncrypted)).toBe("sk-super-secret-plaintext");
                expect(loadProviderApiKey(row)).toBe("sk-super-secret-plaintext");
            });

            it("has_api_key is false and the column is null when no api_key is given", async () => {
                const dto = await createProvider({ name: "no-secret", base_url: "https://api.example.com/v1" });
                const row = db.select().from(schema.providers).where(eq(schema.providers.id, dto.id)).get()!;
                expect(row.apiKeyEncrypted).toBeNull();
                expect(dto.has_api_key).toBe(false);
            });
        });

        describe("adapter_id auto-detection", () => {
            // NOTE: this used to document a confirmed production bug —
            // `lib/server/adapters/register.ts` intended registration
            // order [azure-foundry, azure-openai, openai (catch-all)],
            // but `azure-foundry.ts`'s VALUE import of `./openai` forced
            // openai.ts (and its own `registerAdapter` call) to evaluate
            // first, so the unconditional openai catch-all won every
            // auto-detection race regardless of host — silently
            // misconfiguring any Azure provider created without an
            // explicit `adapter_id`. The registry has since been fixed to
            // make matching registration-order-independent: adapters carry
            // an explicit `fallback` flag (see `openai.ts`), and
            // `resolveAdapter()` (`lib/server/adapters/index.ts`) skips
            // `fallback`-flagged adapters during the specific-match probe,
            // only using them as the final default. These tests now assert
            // that fixed, correct behaviour.
            it("detects azure-openai for *.openai.azure.com hosts", async () => {
                const dto = await createProvider({ name: "az-openai", base_url: "https://my-res.openai.azure.com" });
                expect(dto.adapter_id).toBe("azure-openai");
            });

            it("detects azure-foundry for *.inference.ai.azure.com hosts", async () => {
                const dto = await createProvider({ name: "az-foundry-inf", base_url: "https://my-res.inference.ai.azure.com" });
                expect(dto.adapter_id).toBe("azure-foundry");
            });

            it("detects azure-foundry for *.services.ai.azure.com hosts", async () => {
                const dto = await createProvider({ name: "az-foundry-svc", base_url: "https://my-res.services.ai.azure.com" });
                expect(dto.adapter_id).toBe("azure-foundry");
            });

            it("falls back to the openai catch-all adapter for any other host", async () => {
                const dto = await createProvider({ name: "generic", base_url: "https://api.deepseek.com/v1" });
                expect(dto.adapter_id).toBe("openai");
            });

            it("honors an explicit adapter_id verbatim, skipping auto-detection", async () => {
                const dto = await createProvider({
                    name: "explicit-azure-on-generic-host",
                    base_url: "https://api.deepseek.com/v1",
                    adapter_id: "azure-openai",
                });
                expect(dto.adapter_id).toBe("azure-openai");
            });

            it("passes through an unregistered custom adapter_id string as-is", async () => {
                const dto = await createProvider({
                    name: "unregistered-adapter",
                    base_url: "https://api.example.com/v1",
                    adapter_id: "totally-custom-adapter",
                });
                expect(dto.adapter_id).toBe("totally-custom-adapter");
                // Discovery still works (resolveAdapter falls back to the
                // registry walk / openai catch-all when the stored id isn't
                // a registered adapter), so n_models doesn't blow up.
                const refetched = await getProvider(dto.id);
                expect(refetched.n_models).toBe(0);
            });
        });
    });

    describe("updateProvider", () => {
        it("throws 404 when missing", async () => {
            await expectHttpError(() => updateProvider("nope", { name: "x" }), 404);
        });

        it("only overwrites fields that are explicitly specified", async () => {
            const p = seedProvider({
                name: "orig-name",
                baseUrl: "https://api.example.com/v1",
                adapterId: "openai",
                documentPage: "https://docs.example.com",
            });
            const dto = await updateProvider(p.id, { document_page: "https://new-docs.example.com" });
            expect(dto.document_page).toBe("https://new-docs.example.com");
            expect(dto.name).toBe("orig-name");
            expect(dto.base_url).toBe("https://api.example.com/v1");
            expect(dto.adapter_id).toBe("openai");
        });

        it("rejects renaming to an empty string", async () => {
            const p = seedProvider();
            await expectHttpError(() => updateProvider(p.id, { name: "   " }), 400);
        });

        it("rejects renaming to another provider's existing name", async () => {
            seedProvider({ name: "taken" });
            const p = seedProvider({ name: "mine" });
            const err = await expectHttpError(() => updateProvider(p.id, { name: "taken" }), 400);
            expect(err.message).toMatch(/already exists/i);
        });

        it("allows 'renaming' to its own current name without a false duplicate error", async () => {
            const p = seedProvider({ name: "same-name" });
            const dto = await updateProvider(p.id, { name: "same-name" });
            expect(dto.name).toBe("same-name");
        });

        it("rejects an empty adapter_id", async () => {
            const p = seedProvider();
            await expectHttpError(() => updateProvider(p.id, { adapter_id: "  " }), 400);
        });

        it("rejects an empty base_url", async () => {
            const p = seedProvider();
            await expectHttpError(() => updateProvider(p.id, { base_url: "  " }), 400);
        });

        it("updates adapter_id/base_url when non-empty", async () => {
            const p = seedProvider({ adapterId: "openai", baseUrl: "https://api.example.com/v1" });
            const dto = await updateProvider(p.id, { adapter_id: "azure-openai", base_url: "https://res.openai.azure.com" });
            expect(dto.adapter_id).toBe("azure-openai");
            expect(dto.base_url).toBe("https://res.openai.azure.com");
        });

        describe("api_key update semantics", () => {
            it("treats an explicit null as 'clear the secret'", async () => {
                const p = seedProvider(); // has an encrypted key by default
                const dto = await updateProvider(p.id, { api_key: null });
                expect(dto.has_api_key).toBe(false);
                const row = db.select().from(schema.providers).where(eq(schema.providers.id, p.id)).get()!;
                expect(row.apiKeyEncrypted).toBeNull();
            });

            it("treats an empty string as 'unchanged', not a clear", async () => {
                const p = seedProvider();
                const before = db.select().from(schema.providers).where(eq(schema.providers.id, p.id)).get()!;
                const dto = await updateProvider(p.id, { api_key: "" });
                expect(dto.has_api_key).toBe(true);
                const after = db.select().from(schema.providers).where(eq(schema.providers.id, p.id)).get()!;
                expect(after.apiKeyEncrypted).toBe(before.apiKeyEncrypted);
            });

            it("re-encrypts when given a new non-empty value", async () => {
                const p = seedProvider();
                await updateProvider(p.id, { api_key: "sk-new-secret" });
                const row = db.select().from(schema.providers).where(eq(schema.providers.id, p.id)).get()!;
                expect(row.apiKeyEncrypted).not.toContain("sk-new-secret");
                expect(decryptSecret(row.apiKeyEncrypted)).toBe("sk-new-secret");
            });

            it("leaves the key untouched when api_key is omitted entirely", async () => {
                const p = seedProvider();
                const before = db.select().from(schema.providers).where(eq(schema.providers.id, p.id)).get()!;
                await updateProvider(p.id, { name: "renamed-only" });
                const after = db.select().from(schema.providers).where(eq(schema.providers.id, p.id)).get()!;
                expect(after.apiKeyEncrypted).toBe(before.apiKeyEncrypted);
            });
        });

        describe("health_check_url reset semantics", () => {
            it("resets last_health_* fields when the URL actually changes", async () => {
                const p = seedProvider({
                    healthCheckUrl: "https://api.example.com/health",
                    lastHealthStatus: "ok",
                    lastHealthCheckedAt: new Date().toISOString(),
                    lastHealthError: null,
                });
                const dto = await updateProvider(p.id, { health_check_url: "https://api.example.com/health-v2" });
                expect(dto.health_check_url).toBe("https://api.example.com/health-v2");
                expect(dto.last_health_status).toBeNull();
                expect(dto.last_health_checked_at).toBeNull();
                expect(dto.last_health_error).toBeNull();
            });

            it("does NOT reset last_health_* fields when the URL is set to the same value", async () => {
                const checkedAt = new Date().toISOString();
                const p = seedProvider({
                    healthCheckUrl: "https://api.example.com/health",
                    lastHealthStatus: "ok",
                    lastHealthCheckedAt: checkedAt,
                    lastHealthError: null,
                });
                const dto = await updateProvider(p.id, { health_check_url: "https://api.example.com/health" });
                expect(dto.last_health_status).toBe("ok");
                expect(dto.last_health_checked_at).toBe(checkedAt);
            });

            it("clears health_check_url and resets last_health_* when set to null", async () => {
                const p = seedProvider({
                    healthCheckUrl: "https://api.example.com/health",
                    lastHealthStatus: "down",
                    lastHealthCheckedAt: new Date().toISOString(),
                    lastHealthError: "boom",
                });
                const dto = await updateProvider(p.id, { health_check_url: null });
                expect(dto.health_check_url).toBeNull();
                expect(dto.last_health_status).toBeNull();
                expect(dto.last_health_error).toBeNull();
            });
        });

        it("toggles is_local and enabled", async () => {
            const p = seedProvider({ isLocal: false, enabled: true });
            const dto = await updateProvider(p.id, { is_local: true, enabled: false });
            expect(dto.is_local).toBe(true);
            expect(dto.enabled).toBe(false);
        });

        it("replaces default_params wholesale rather than deep-merging", async () => {
            const p = seedProvider({ defaultParams: { temperature: 0.2, top_p: 0.9 } });
            const dto = await updateProvider(p.id, { default_params: { max_tokens: 100 } });
            expect(dto.default_params).toEqual({ max_tokens: 100 });
        });

        it("nulls dependent models' discovered_metadata when adapter_id actually changes", async () => {
            const p = seedProvider({ adapterId: "openai" });
            const m = seedModel({ providerId: p.id, discoveredMetadata: { upstream_id: "foo", raw: { legacy: true } } });
            await updateProvider(p.id, { adapter_id: "azure-openai" });
            const row = db.select().from(schema.models).where(eq(schema.models.id, m.id)).get()!;
            expect(row.discoveredMetadata).toBeNull();
        });

        it("does NOT null models' discovered_metadata when adapter_id is set to its current value", async () => {
            const p = seedProvider({ adapterId: "openai" });
            const m = seedModel({ providerId: p.id, discoveredMetadata: { upstream_id: "foo" } });
            await updateProvider(p.id, { adapter_id: "openai" });
            const row = db.select().from(schema.models).where(eq(schema.models.id, m.id)).get()!;
            expect(row.discoveredMetadata).toEqual({ upstream_id: "foo" });
        });

        describe("discovery cache invalidation", () => {
            // NOTE: `updateProvider` always ends with `return getProvider(...)`,
            // which itself re-warms the cache immediately whenever the provider
            // is enabled (see discoveredCountForProvider). So `getDiscoveryStatus`
            // right after an `updateProvider` call is NOT a reliable signal for
            // "was the cache cleared mid-update" — it would show "warm" either
            // way. Instead we assert on fetch call *counts*: a cosmetic-only
            // update reuses the still-warm cache (no new fetch), while a
            // discovery-affecting update evicts the cache so updateProvider's
            // own trailing getProvider() call misses and re-fetches.
            it("does not trigger a re-fetch on a cosmetic-only update (cache stays warm)", async () => {
                const fetchSpy = stubFetch();
                const p = seedProvider();
                await getProvider(p.id); // cold — 1 fetch, warms the cache
                expect(fetchSpy).toHaveBeenCalledTimes(1);

                await updateProvider(p.id, {
                    document_page: "https://docs.example.com",
                    model_page: "https://models.example.com",
                    name: "cosmetic-rename",
                    is_local: true,
                });
                expect(fetchSpy).toHaveBeenCalledTimes(1);
            });

            it.each([
                ["base_url", { base_url: "https://api2.example.com/v1" }],
                ["api_version", { api_version: "2024-01-01" }],
                ["adapter_id", { adapter_id: "azure-openai" }],
                ["api_key", { api_key: "sk-rotated" }],
            ])("triggers a re-fetch after a discovery-affecting %s update (cache evicted)", async (_label, patch) => {
                const fetchSpy = stubFetch();
                const p = seedProvider();
                await getProvider(p.id); // cold — 1 fetch, warms the cache
                expect(fetchSpy).toHaveBeenCalledTimes(1);

                await updateProvider(p.id, patch);
                // clearDiscoveryCacheFor evicted the entry mid-update, so
                // updateProvider's own trailing getProvider() call misses
                // and issues a second fetch.
                expect(fetchSpy).toHaveBeenCalledTimes(2);
            });

            it("treats (re-)enabling a disabled provider as discovery-affecting", async () => {
                const fetchSpy = stubFetch();
                const p = seedProvider({ enabled: false });
                await getProvider(p.id); // disabled — short-circuits, no fetch at all
                expect(fetchSpy).not.toHaveBeenCalled();

                await updateProvider(p.id, { enabled: true });
                // trailing getProvider() call now runs with enabled:true and must fetch.
                expect(fetchSpy).toHaveBeenCalledTimes(1);
            });
        });
    });

    describe("deleteProvider", () => {
        it("throws 404 when missing", async () => {
            await expectHttpError(() => deleteProvider("nope"), 404);
        });

        it("removes the row and clears its discovery cache entry", async () => {
            const p = seedProvider();
            await getProvider(p.id); // warms the cache
            expect(getDiscoveryStatus(p.id)).not.toBeNull();

            await deleteProvider(p.id);
            expect(findProviderByIdOrName(p.id)).toBeUndefined();
            expect(getDiscoveryStatus(p.id)).toBeNull();
        });
    });

    describe("probeHealthCheckUrl", () => {
        it("succeeds on an exact {status:'ok'} body", async () => {
            stubFetch(() => Promise.resolve({ ok: true, json: async () => ({ status: "ok" }) }));
            const result = await probeHealthCheckUrl("https://api.example.com/health");
            expect(result.ok).toBe(true);
            expect(result.error).toBeUndefined();
            expect(result.latency_ms).toBeGreaterThanOrEqual(0);
        });

        it("fails with an HTTP-status message on a non-ok response", async () => {
            stubFetch(() => Promise.resolve({ ok: false, status: 503, text: async () => "Service Unavailable" }));
            const result = await probeHealthCheckUrl("https://api.example.com/health");
            expect(result.ok).toBe(false);
            expect(result.error).toMatch(/HTTP 503/);
        });

        it("fails with a shape-mismatch message on unexpected JSON", async () => {
            stubFetch(() => Promise.resolve({ ok: true, json: async () => ({ status: "nope" }) }));
            const result = await probeHealthCheckUrl("https://api.example.com/health");
            expect(result.ok).toBe(false);
            expect(result.error).toMatch(/Expected \{"status":"ok"\}/);
        });

        it("fails gracefully when the body isn't JSON at all", async () => {
            stubFetch(() => Promise.resolve({ ok: true, json: async () => { throw new Error("not json"); } }));
            const result = await probeHealthCheckUrl("https://api.example.com/health");
            expect(result.ok).toBe(false);
            expect(result.error).toMatch(/Expected \{"status":"ok"\}/);
        });

        it("fails with the exception message on a network error", async () => {
            stubFetch(() => Promise.reject(new Error("getaddrinfo ENOTFOUND")));
            const result = await probeHealthCheckUrl("https://api.example.com/health");
            expect(result.ok).toBe(false);
            expect(result.error).toBe("getaddrinfo ENOTFOUND");
        });
    });

    describe("checkProvider", () => {
        it("throws 404 when missing", async () => {
            await expectHttpError(() => checkProvider("nope"), 404);
        });

        describe("with a health_check_url", () => {
            it("persists an ok result", async () => {
                stubFetch(() => Promise.resolve({ ok: true, json: async () => ({ status: "ok" }) }));
                const p = seedProvider({ healthCheckUrl: "https://api.example.com/health" });
                const result = await checkProvider(p.id);
                expect(result.ok).toBe(true);

                const row = db.select().from(schema.providers).where(eq(schema.providers.id, p.id)).get()!;
                expect(row.lastHealthStatus).toBe("ok");
                expect(row.lastHealthCheckedAt).toEqual(expect.any(String));
                expect(row.lastHealthError).toBeNull();
            });

            it("persists a down result with the probe's error message", async () => {
                stubFetch(() => Promise.resolve({ ok: true, json: async () => ({ status: "bad" }) }));
                const p = seedProvider({ healthCheckUrl: "https://api.example.com/health" });
                const result = await checkProvider(p.id);
                expect(result.ok).toBe(false);

                const row = db.select().from(schema.providers).where(eq(schema.providers.id, p.id)).get()!;
                expect(row.lastHealthStatus).toBe("down");
                expect(row.lastHealthError).toMatch(/Expected/);
            });

            it("persists a down result on a network failure", async () => {
                stubFetch(() => Promise.reject(new Error("connection refused")));
                const p = seedProvider({ healthCheckUrl: "https://api.example.com/health" });
                const result = await checkProvider(p.id);
                expect(result.ok).toBe(false);
                expect(result.error).toBe("connection refused");

                const row = db.select().from(schema.providers).where(eq(schema.providers.id, p.id)).get()!;
                expect(row.lastHealthStatus).toBe("down");
                expect(row.lastHealthError).toBe("connection refused");
            });

            it("never overwrites a later probe's result with an out-of-order (older) write", async () => {
                const future = new Date(Date.now() + 60_000).toISOString();
                stubFetch(() => Promise.resolve({ ok: true, json: async () => ({ status: "ok" }) }));
                const p = seedProvider({
                    healthCheckUrl: "https://api.example.com/health",
                    lastHealthStatus: "down",
                    lastHealthCheckedAt: future,
                    lastHealthError: "stale-newer-error",
                });
                await checkProvider(p.id);
                const row = db.select().from(schema.providers).where(eq(schema.providers.id, p.id)).get()!;
                // The started_at captured inside checkProvider is "now", which
                // is earlier than the already-recorded `future` timestamp, so
                // the guarded UPDATE must not have applied.
                expect(row.lastHealthStatus).toBe("down");
                expect(row.lastHealthCheckedAt).toBe(future);
                expect(row.lastHealthError).toBe("stale-newer-error");
            });
        });

        describe("without a health_check_url (discovery fallback)", () => {
            it("returns ok + the discovered model count on success", async () => {
                stubFetch(() => Promise.resolve({ ok: true, json: async () => ({ data: [{ id: "m1" }, { id: "m2" }, { id: "m3" }] }) }));
                const p = seedProvider({ healthCheckUrl: null });
                const result = await checkProvider(p.id);
                expect(result).toMatchObject({ ok: true, models: 3 });
                expect(result.latency_ms).toBeGreaterThanOrEqual(0);
            });

            it("does NOT touch last_health_* columns (those are reserved for the explicit health_check_url contract)", async () => {
                stubFetch(() => Promise.resolve({ ok: true, json: async () => ({ data: [] }) }));
                const p = seedProvider({ healthCheckUrl: null, lastHealthStatus: null });
                await checkProvider(p.id);
                const row = db.select().from(schema.providers).where(eq(schema.providers.id, p.id)).get()!;
                expect(row.lastHealthStatus).toBeNull();
            });

            it("returns ok:false + the error message when discovery fails", async () => {
                stubFetch(() => Promise.resolve({ ok: false, status: 500 }));
                const p = seedProvider({ healthCheckUrl: null });
                const result = await checkProvider(p.id);
                expect(result.ok).toBe(false);
                expect(result.error).toMatch(/models discovery HTTP 500/);
            });
        });
    });
});
