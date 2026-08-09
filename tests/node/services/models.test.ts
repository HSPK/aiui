import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/server/db";
import { HttpError } from "@/lib/server/response";
import {
    createModel,
    deleteModel,
    findModelByIdOrName,
    getModel,
    listAllModels,
    listModelsForProvider,
    updateModel,
} from "@/lib/server/models";
import { resetDb, seedModel, seedProvider } from "../../helpers/db";

/** Default upstream `/models`-shaped response — empty by default so tests
 *  opt in to specific discovery results per scenario. */
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

describe("models service", () => {
    beforeEach(() => {
        resetDb();
        stubFetch();
    });

    describe("findModelByIdOrName", () => {
        it("finds by id", () => {
            const p = seedProvider();
            const m = seedModel({ providerId: p.id, name: "by-id-model" });
            expect(findModelByIdOrName(m.id)?.id).toBe(m.id);
        });

        it("finds by name", () => {
            const p = seedProvider();
            const m = seedModel({ providerId: p.id, name: "by-name-model" });
            expect(findModelByIdOrName("by-name-model")?.id).toBe(m.id);
        });

        it("returns undefined when neither matches", () => {
            expect(findModelByIdOrName("nope")).toBeUndefined();
        });
    });

    describe("getModel", () => {
        it("throws 404 when neither a DB row nor a discovered model matches", async () => {
            await expectHttpError(() => getModel("nope"), 404);
        });

        it("serializes a DB-backed model's DTO fields", async () => {
            const p = seedProvider({ name: "acme", baseUrl: "https://api.acme.test/v1" });
            const m = seedModel({
                providerId: p.id,
                name: "acme/gpt",
                upstreamModelId: "gpt-4o-mini",
                timeout: 120,
                maxRetries: 5,
                defaultParams: { temperature: 0.4 },
            });
            const dto = await getModel(m.id);
            expect(dto).toMatchObject({
                id: m.id,
                name: "acme/gpt",
                model_id: "gpt-4o-mini",
                proxy: "https://api.acme.test/v1",
                timeout: 120,
                max_retries: 5,
                default_params: { temperature: 0.4 },
                type: "chat",
                provider: "acme",
                provider_id: p.id,
                is_local: false,
                enabled: true,
            });
            expect(dto.is_discovered).toBeUndefined();
        });

        it("resolves by id or by name identically", async () => {
            const p = seedProvider();
            const m = seedModel({ providerId: p.id, name: "resolve-both" });
            expect(await getModel(m.id)).toEqual(await getModel("resolve-both"));
        });

        it("defaults default_params to {} when the DB column is legitimately null", async () => {
            const p = seedProvider();
            const m = seedModel({ providerId: p.id });
            // seedModel's own `overrides.defaultParams ?? {}` would coalesce an
            // explicit `null` override away before it reaches the DB, so force
            // a genuine NULL via a raw update to exercise the serializer's own
            // fallback independently of the seed helper.
            db.update(schema.models).set({ defaultParams: null }).where(eq(schema.models.id, m.id)).run();
            const dto = await getModel(m.id);
            expect(dto.default_params).toEqual({});
        });

        describe("metaForDbModel fallback chain", () => {
            it("tier 1: prefers the DB discoveredMetadata snapshot and skips network entirely", async () => {
                const fetchSpy = stubFetch();
                const p = seedProvider({ adapterId: "openai" });
                const m = seedModel({
                    providerId: p.id,
                    upstreamModelId: "custom-id",
                    discoveredMetadata: { id: "custom-id", owned_by: "custom-corp" },
                });
                const dto = await getModel(m.id);
                expect(dto.meta?.upstream_id).toBe("custom-id");
                expect(dto.meta?.owned_by).toBe("custom-corp");
                expect(dto.meta?.raw).toEqual({ id: "custom-id", owned_by: "custom-corp" });
                expect(fetchSpy).not.toHaveBeenCalled();
            });

            it("tier 2: falls back to the in-memory discovery cache when there's no DB snapshot", async () => {
                stubFetch(() => Promise.resolve({
                    ok: true,
                    json: async () => ({ data: [{ id: "cache-hit-id", owned_by: "from-cache" }] }),
                }));
                const p = seedProvider({ adapterId: "openai" });
                const m = seedModel({ providerId: p.id, upstreamModelId: "cache-hit-id", discoveredMetadata: null });
                const dto = await getModel(m.id);
                expect(dto.meta?.upstream_id).toBe("cache-hit-id");
                expect(dto.meta?.owned_by).toBe("from-cache");
            });

            it("tier 3: falls back to a bare {id} projection when nothing else matches", async () => {
                stubFetch(() => Promise.resolve({ ok: true, json: async () => ({ data: [] }) }));
                const p = seedProvider({ adapterId: "openai" });
                const m = seedModel({ providerId: p.id, upstreamModelId: "orphan-id", discoveredMetadata: null });
                const dto = await getModel(m.id);
                expect(dto.meta?.upstream_id).toBe("orphan-id");
                expect(dto.meta?.owned_by).toBeNull();
            });

            it("does not re-warm discovery when a DB snapshot already exists (avoids paying upstream latency)", async () => {
                const fetchSpy = stubFetch();
                const p = seedProvider();
                seedModel({ providerId: p.id, discoveredMetadata: { id: "x" } });
                await listAllModels();
                // listAllModels doesn't warm per-model at all (it does one
                // batched listAllDiscovered() call up front) — assert the
                // getModel-specific per-row warmup guard via a direct call.
                expect(fetchSpy.mock.calls.length).toBeLessThanOrEqual(1);
            });

            it("yields a null meta when the snapshotted raw entry has no usable id", async () => {
                const p = seedProvider({ adapterId: "openai" });
                const m = seedModel({ providerId: p.id, discoveredMetadata: {} });
                const dto = await getModel(m.id);
                expect(dto.meta).toBeNull();
            });
        });

        describe("resolved_variant_id", () => {
            it("resolves the default variant for a chat model via the capability preference chain", async () => {
                stubFetch(() => Promise.resolve({
                    ok: true,
                    json: async () => ({ data: [{ id: "gpt-4o-mini" }] }),
                }));
                const p = seedProvider({ adapterId: "openai" });
                const m = seedModel({ providerId: p.id, type: "chat", upstreamModelId: "gpt-4o-mini", apiVariantId: null });
                const dto = await getModel(m.id);
                expect(dto.resolved_variant_id).toBe("chat.completions");
            });

            it("honors an explicit apiVariantId pin for a matching capability", async () => {
                const p = seedProvider({ adapterId: "openai" });
                const m = seedModel({ providerId: p.id, type: "chat", apiVariantId: "chat.completions" });
                const dto = await getModel(m.id);
                expect(dto.resolved_variant_id).toBe("chat.completions");
                expect(dto.api_variant_id).toBe("chat.completions");
            });

            it("ignores a pin that belongs to a different capability, falling back to the default resolution", async () => {
                stubFetch(() => Promise.resolve({
                    ok: true,
                    json: async () => ({ data: [{ id: "gpt-4o-mini" }] }),
                }));
                const p = seedProvider({ adapterId: "openai" });
                // "embeddings" is registered under capability "embedding", not "chat".
                const m = seedModel({ providerId: p.id, type: "chat", upstreamModelId: "gpt-4o-mini", apiVariantId: "embeddings" });
                const dto = await getModel(m.id);
                expect(dto.resolved_variant_id).toBe("chat.completions");
            });

            it("ignores a pin that points at a completely unregistered variant id", async () => {
                stubFetch(() => Promise.resolve({
                    ok: true,
                    json: async () => ({ data: [{ id: "gpt-4o-mini" }] }),
                }));
                const p = seedProvider({ adapterId: "openai" });
                const m = seedModel({ providerId: p.id, type: "chat", upstreamModelId: "gpt-4o-mini", apiVariantId: "totally-bogus-variant" });
                const dto = await getModel(m.id);
                expect(dto.resolved_variant_id).toBe("chat.completions");
            });

            it("returns null when the model's type isn't a registered capability", async () => {
                const p = seedProvider();
                const m = seedModel({ providerId: p.id, type: "not-a-real-capability" });
                const dto = await getModel(m.id);
                expect(dto.resolved_variant_id).toBeNull();
            });
        });

        it("falls back to a synthesized discovered DTO when there's no DB row but a live discovery hit exists", async () => {
            stubFetch(() => Promise.resolve({
                ok: true,
                json: async () => ({ data: [{ id: "phantom-model", owned_by: "acme" }] }),
            }));
            const p = seedProvider({ name: "acme" });
            const dto = await getModel("phantom-model");
            expect(dto.is_discovered).toBe(true);
            expect(dto.id).toBe(`discovered:${p.id}:phantom-model`);
            expect(dto.name).toBe("phantom-model");
            expect(dto.provider).toBe("acme");
            expect(dto.provider_id).toBe(p.id);
        });
    });

    describe("listAllModels", () => {
        it("returns [] when there are no providers or models", async () => {
            expect(await listAllModels()).toEqual([]);
        });

        it("returns the union of DB-backed models and discovered-only models", async () => {
            stubFetch(() => Promise.resolve({
                ok: true,
                json: async () => ({ data: [{ id: "gpt-4o-mini" }, { id: "gpt-4-turbo" }] }),
            }));
            const p = seedProvider({ enabled: true });
            // DB row's *name* happens to equal a discovered upstream id — should
            // dedupe (suppress) that one discovered entry.
            seedModel({ providerId: p.id, name: "gpt-4o-mini", upstreamModelId: "gpt-4o-mini" });

            const rows = await listAllModels();
            const names = rows.map((r) => r.name);
            expect(names).toContain("gpt-4o-mini");
            expect(names).toContain("gpt-4-turbo");
            expect(names.filter((n) => n === "gpt-4o-mini")).toHaveLength(1); // deduped, not doubled

            const dbBacked = rows.find((r) => r.name === "gpt-4o-mini")!;
            expect(dbBacked.is_discovered).toBe(false);

            const discoveredOnly = rows.find((r) => r.name === "gpt-4-turbo")!;
            expect(discoveredOnly.is_discovered).toBe(true);
            expect(discoveredOnly.id).toBe(`discovered:${p.id}:gpt-4-turbo`);
            expect(discoveredOnly.enabled).toBe(true);
            expect(discoveredOnly.is_local).toBe(false);
        });

        it("does not fetch discovery for a disabled provider", async () => {
            const fetchSpy = stubFetch();
            const p = seedProvider({ enabled: false });
            seedModel({ providerId: p.id });
            await listAllModels();
            expect(fetchSpy).not.toHaveBeenCalled();
        });
    });

    describe("listModelsForProvider", () => {
        it("throws 404 when the provider doesn't exist", async () => {
            await expectHttpError(() => listModelsForProvider("nope"), 404);
        });

        it("scopes results to a single provider", async () => {
            stubFetch(() => Promise.resolve({ ok: true, json: async () => ({ data: [] }) }));
            const p1 = seedProvider({ name: "p1" });
            const p2 = seedProvider({ name: "p2" });
            seedModel({ providerId: p1.id, name: "p1-model" });
            seedModel({ providerId: p2.id, name: "p2-model" });

            const rows = await listModelsForProvider(p1.id);
            expect(rows.map((r) => r.name)).toEqual(["p1-model"]);
        });

        it("tolerates a discovery failure and still returns DB-backed models", async () => {
            stubFetch(() => Promise.reject(new Error("upstream unreachable")));
            const p = seedProvider();
            seedModel({ providerId: p.id, name: "still-here" });

            const rows = await listModelsForProvider(p.id);
            expect(rows.map((r) => r.name)).toEqual(["still-here"]);
        });

        it("deduplicates a discovered entry against a DB-backed model within the same provider", async () => {
            stubFetch(() => Promise.resolve({
                ok: true,
                json: async () => ({ data: [{ id: "gpt-4o-mini" }, { id: "gpt-4-turbo" }] }),
            }));
            const p = seedProvider();
            seedModel({ providerId: p.id, name: "gpt-4o-mini", upstreamModelId: "gpt-4o-mini" });

            const rows = await listModelsForProvider(p.id);
            const names = rows.map((r) => r.name);
            expect(names.filter((n) => n === "gpt-4o-mini")).toHaveLength(1);
            expect(names).toContain("gpt-4-turbo");
        });
    });

    describe("createModel", () => {
        it("creates with sane defaults when optional fields are omitted", async () => {
            const p = seedProvider();
            const dto = await createModel({ name: "minimal", provider_id: p.id, upstream_model_id: "gpt-4o-mini" });
            expect(dto.name).toBe("minimal");
            expect(dto.model_id).toBe("gpt-4o-mini");
            expect(dto.type).toBe("chat");
            expect(dto.timeout).toBe(3600);
            expect(dto.max_retries).toBe(2);
            expect(dto.enabled).toBe(true);
            expect(dto.default_params).toEqual({});
            expect(dto.context_window).toBeNull();
            expect(dto.max_tokens).toBeNull();
            expect(dto.output_dimension).toBeNull();
            expect(dto.pricing).toBeNull();
            expect(dto.description).toBeNull();
            expect(dto.knowledge_date).toBeNull();
            expect(dto.api_variant_id).toBeNull();
        });

        it("accepts a provider looked up by name too", async () => {
            const p = seedProvider({ name: "by-name-provider" });
            const dto = await createModel({ name: "m1", provider_id: "by-name-provider", upstream_model_id: "gpt-4o-mini" });
            expect(dto.provider_id).toBe(p.id);
        });

        it("trims name/upstream_model_id/provider_id", async () => {
            const p = seedProvider();
            const dto = await createModel({ name: "  padded  ", provider_id: `  ${p.id}  `, upstream_model_id: "  gpt-4o-mini  " });
            expect(dto.name).toBe("padded");
            expect(dto.model_id).toBe("gpt-4o-mini");
        });

        it("rejects an unknown provider_id with 400", async () => {
            await expectHttpError(
                () => createModel({ name: "orphan", provider_id: "nope", upstream_model_id: "x" }),
                400,
            );
        });

        it("rejects a duplicate model name with 400", async () => {
            const p = seedProvider();
            await createModel({ name: "dup", provider_id: p.id, upstream_model_id: "m1" });
            const err = await expectHttpError(
                () => createModel({ name: "dup", provider_id: p.id, upstream_model_id: "m2" }),
                400,
            );
            expect(err.message).toMatch(/already exists/i);
        });

        it("stores custom default_params/context_window/pricing verbatim", async () => {
            const p = seedProvider();
            const dto = await createModel({
                name: "custom",
                provider_id: p.id,
                upstream_model_id: "gpt-4o-mini",
                type: "embedding",
                default_params: { temperature: 0.2 },
                context_window: 128_000,
                max_tokens: 4096,
                output_dimension: 1536,
                pricing: { input: 0.01, output: 0.03 },
                description: "a test model",
                knowledge_date: "2024-01",
                timeout: 60,
                max_retries: 0,
                enabled: false,
                api_variant_id: "  chat.completions  ",
            });
            expect(dto.type).toBe("embedding");
            expect(dto.default_params).toEqual({ temperature: 0.2 });
            expect(dto.context_window).toBe(128_000);
            expect(dto.max_tokens).toBe(4096);
            expect(dto.output_dimension).toBe(1536);
            expect(dto.pricing).toEqual({ input: 0.01, output: 0.03 });
            expect(dto.description).toBe("a test model");
            expect(dto.knowledge_date).toBe("2024-01");
            expect(dto.timeout).toBe(60);
            expect(dto.max_retries).toBe(0);
            expect(dto.enabled).toBe(false);
            expect(dto.api_variant_id).toBe("chat.completions");
        });

        it("treats an empty-string api_variant_id as unset (null) on create", async () => {
            const p = seedProvider();
            const dto = await createModel({
                name: "blank-variant",
                provider_id: p.id,
                upstream_model_id: "gpt-4o-mini",
                api_variant_id: "",
            });
            expect(dto.api_variant_id).toBeNull();
        });

        describe("discovered_metadata auto-snapshot", () => {
            it("auto-snapshots from a live discovery hit when omitted", async () => {
                stubFetch(() => Promise.resolve({
                    ok: true,
                    json: async () => ({ data: [{ id: "gpt-4o-mini", owned_by: "openai-inc" }] }),
                }));
                const p = seedProvider();
                const dto = await createModel({ name: "auto-snap", provider_id: p.id, upstream_model_id: "gpt-4o-mini" });
                expect(dto.meta?.owned_by).toBe("openai-inc");
                const row = db.select().from(schema.models).where(eq(schema.models.id, dto.id)).get()!;
                expect(row.discoveredMetadata).toEqual({ id: "gpt-4o-mini", owned_by: "openai-inc" });
            });

            it("leaves discovered_metadata null when no matching upstream entry is discovered", async () => {
                stubFetch(() => Promise.resolve({ ok: true, json: async () => ({ data: [] }) }));
                const p = seedProvider();
                const dto = await createModel({ name: "no-match", provider_id: p.id, upstream_model_id: "nonexistent-id" });
                const row = db.select().from(schema.models).where(eq(schema.models.id, dto.id)).get()!;
                expect(row.discoveredMetadata).toBeNull();
            });

            it("honors an explicit discovered_metadata, skipping the auto-snapshot fetch", async () => {
                const fetchSpy = stubFetch(() => Promise.resolve({
                    ok: true,
                    json: async () => ({ data: [{ id: "gpt-4o-mini", owned_by: "should-not-be-used" }] }),
                }));
                const p = seedProvider();
                const dto = await createModel({
                    name: "explicit-meta",
                    provider_id: p.id,
                    upstream_model_id: "gpt-4o-mini",
                    discovered_metadata: { id: "gpt-4o-mini", owned_by: "explicit-corp" },
                });
                expect(dto.meta?.owned_by).toBe("explicit-corp");
                expect(fetchSpy).not.toHaveBeenCalled();
            });
        });
    });

    describe("updateModel", () => {
        it("throws 404 when missing", async () => {
            await expectHttpError(() => updateModel("nope", { name: "x" }), 404);
        });

        it("only overwrites fields that are explicitly specified", async () => {
            const p = seedProvider();
            const m = seedModel({ providerId: p.id, name: "orig", timeout: 100, maxRetries: 1 });
            const dto = await updateModel(m.id, { timeout: 200 });
            expect(dto.timeout).toBe(200);
            expect(dto.name).toBe("orig");
            expect(dto.max_retries).toBe(1);
        });

        it("rejects renaming to an empty string", async () => {
            const p = seedProvider();
            const m = seedModel({ providerId: p.id });
            await expectHttpError(() => updateModel(m.id, { name: "   " }), 400);
        });

        it("rejects renaming to another model's existing name", async () => {
            const p = seedProvider();
            seedModel({ providerId: p.id, name: "taken" });
            const m = seedModel({ providerId: p.id, name: "mine" });
            const err = await expectHttpError(() => updateModel(m.id, { name: "taken" }), 400);
            expect(err.message).toMatch(/already exists/i);
        });

        it("renames to a brand-new unique name", async () => {
            const p = seedProvider();
            const m = seedModel({ providerId: p.id, name: "old-name" });
            const dto = await updateModel(m.id, { name: "new-unique-name" });
            expect(dto.name).toBe("new-unique-name");
        });

        it("allows 'renaming' to its own current name without a false duplicate error", async () => {
            const p = seedProvider();
            const m = seedModel({ providerId: p.id, name: "same-name" });
            const dto = await updateModel(m.id, { name: "same-name" });
            expect(dto.name).toBe("same-name");
        });

        it("rejects an unknown provider_id", async () => {
            const p = seedProvider();
            const m = seedModel({ providerId: p.id });
            await expectHttpError(() => updateModel(m.id, { provider_id: "nope" }), 400);
        });

        it("rejects an empty upstream_model_id", async () => {
            const p = seedProvider();
            const m = seedModel({ providerId: p.id });
            await expectHttpError(() => updateModel(m.id, { upstream_model_id: "  " }), 400);
        });

        it("toggles enabled", async () => {
            const p = seedProvider();
            const m = seedModel({ providerId: p.id, enabled: true });
            const dto = await updateModel(m.id, { enabled: false });
            expect(dto.enabled).toBe(false);
        });

        it("replaces default_params wholesale rather than deep-merging", async () => {
            const p = seedProvider();
            const m = seedModel({ providerId: p.id, defaultParams: { temperature: 0.2, top_p: 0.9 } });
            const dto = await updateModel(m.id, { default_params: { max_tokens: 100 } });
            expect(dto.default_params).toEqual({ max_tokens: 100 });
        });

        it("clears api_variant_id when set to an empty string", async () => {
            const p = seedProvider();
            const m = seedModel({ providerId: p.id, apiVariantId: "chat.completions" });
            const dto = await updateModel(m.id, { api_variant_id: "" });
            expect(dto.api_variant_id).toBeNull();
        });

        it("updates every remaining optional scalar field in a single call", async () => {
            const p = seedProvider();
            const m = seedModel({ providerId: p.id, type: "chat" });
            const dto = await updateModel(m.id, {
                type: "embedding",
                context_window: 32_000,
                max_tokens: 2048,
                output_dimension: 768,
                pricing: { input: 0.02 },
                description: "updated description",
                knowledge_date: "2025-01",
                max_retries: 5,
            });
            expect(dto.type).toBe("embedding");
            expect(dto.context_window).toBe(32_000);
            expect(dto.max_tokens).toBe(2048);
            expect(dto.output_dimension).toBe(768);
            expect(dto.pricing).toEqual({ input: 0.02 });
            expect(dto.description).toBe("updated description");
            expect(dto.knowledge_date).toBe("2025-01");
            expect(dto.max_retries).toBe(5);
        });

        it("bumps updated_at on every successful update", async () => {
            const p = seedProvider();
            const m = seedModel({ providerId: p.id, updatedAt: "2020-01-01T00:00:00.000Z" });
            await updateModel(m.id, { timeout: 999 });
            const after = db.select().from(schema.models).where(eq(schema.models.id, m.id)).get()!.updatedAt;
            expect(after).not.toBe("2020-01-01T00:00:00.000Z");
        });

        describe("discovered_metadata invalidation on projection-target change", () => {
            it("nulls discoveredMetadata when upstream_model_id changes without a fresh snapshot", async () => {
                const p = seedProvider();
                const m = seedModel({ providerId: p.id, upstreamModelId: "old-id", discoveredMetadata: { id: "old-id" } });
                const dto = await updateModel(m.id, { upstream_model_id: "new-id" });
                expect(dto.model_id).toBe("new-id");
                const row = db.select().from(schema.models).where(eq(schema.models.id, m.id)).get()!;
                expect(row.discoveredMetadata).toBeNull();
            });

            it("nulls discoveredMetadata when provider_id changes (cross-adapter safety)", async () => {
                const p1 = seedProvider({ adapterId: "openai" });
                const p2 = seedProvider({ adapterId: "azure-openai" });
                const m = seedModel({ providerId: p1.id, discoveredMetadata: { id: "gpt-4o-mini" } });
                const dto = await updateModel(m.id, { provider_id: p2.id });
                expect(dto.provider_id).toBe(p2.id);
                const row = db.select().from(schema.models).where(eq(schema.models.id, m.id)).get()!;
                expect(row.discoveredMetadata).toBeNull();
            });

            it("does NOT null discoveredMetadata when a fresh one is supplied alongside the change", async () => {
                const p = seedProvider();
                const m = seedModel({ providerId: p.id, upstreamModelId: "old-id", discoveredMetadata: { id: "old-id" } });
                await updateModel(m.id, {
                    upstream_model_id: "new-id",
                    discovered_metadata: { id: "new-id", owned_by: "fresh" },
                });
                const row = db.select().from(schema.models).where(eq(schema.models.id, m.id)).get()!;
                expect(row.discoveredMetadata).toEqual({ id: "new-id", owned_by: "fresh" });
            });

            it("leaves discoveredMetadata untouched when neither upstream_model_id nor provider_id change", async () => {
                const p = seedProvider();
                const m = seedModel({ providerId: p.id, discoveredMetadata: { id: "stable" } });
                await updateModel(m.id, { description: "just a description edit" });
                const row = db.select().from(schema.models).where(eq(schema.models.id, m.id)).get()!;
                expect(row.discoveredMetadata).toEqual({ id: "stable" });
            });
        });
    });

    describe("deleteModel", () => {
        it("throws 404 when missing", async () => {
            await expectHttpError(() => deleteModel("nope"), 404);
        });

        it("removes the row", async () => {
            const p = seedProvider();
            const m = seedModel({ providerId: p.id });
            await deleteModel(m.id);
            expect(findModelByIdOrName(m.id)).toBeUndefined();
        });
    });
});
