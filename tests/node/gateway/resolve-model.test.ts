// Tests for `resolveModel` — the model/provider/adapter/meta resolution
// step at the front of the gateway pipeline. Covers every branch: DB
// hit (with/without a discovery-cache assist), disabled model/provider,
// missing provider, and the pure-discovery fallback path.
import { beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "@/lib/server/db";
import { resolveModel } from "@/lib/server/gateway";
import { discoveredForProvider, clearDiscoveryCache } from "@/lib/server/discovery";
import { decryptSecret } from "@/lib/server/crypto";
import { resetDb, seedModel, seedProvider } from "@/tests/helpers/db";
import { jsonResponse, mockFetch } from "./helpers";

describe("resolveModel", () => {
    beforeEach(() => {
        resetDb();
        clearDiscoveryCache();
    });

    it("DB hit: resolves provider/adapter/meta straight from the stored discoveredMetadata snapshot", async () => {
        const provider = seedProvider({ adapterId: "openai" });
        const model = seedModel({
            providerId: provider.id,
            upstreamModelId: "gpt-4o-mini",
            discoveredMetadata: { id: "gpt-4o-mini", owned_by: "snapshot-owner" },
        });

        const resolved = await resolveModel(model.name);

        expect(resolved.discovered).toBe(false);
        expect(resolved.model.id).toBe(model.id);
        expect(resolved.provider.id).toBe(provider.id);
        expect(resolved.adapter.id).toBe("openai");
        expect(resolved.meta?.upstream_id).toBe("gpt-4o-mini");
        expect(resolved.meta?.owned_by).toBe("snapshot-owner");
        expect(resolved.meta?.capabilities.chat).toBe(true);
        expect(resolved.apiKey).toBe(decryptSecret(provider.apiKeyEncrypted));
    });

    it("DB hit: resolves by DB id as well as by name (findModelByIdOrName)", async () => {
        const provider = seedProvider();
        const model = seedModel({ providerId: provider.id });
        const resolved = await resolveModel(model.id);
        expect(resolved.model.id).toBe(model.id);
    });

    it("throws 400 when the model is disabled", async () => {
        const provider = seedProvider();
        const model = seedModel({ providerId: provider.id, enabled: false });
        await expect(resolveModel(model.name)).rejects.toMatchObject({
            status: 400,
            message: `Model "${model.name}" is disabled`,
        });
    });

    it("throws 404 when the model's provider row no longer exists", async () => {
        // models.provider_id has an FK (ON DELETE CASCADE), so a model can
        // never legitimately outlive its provider through normal app
        // flows — simulate the edge case (e.g. a manually-edited DB) by
        // disabling FK enforcement for one raw insert.
        const now = new Date().toISOString();
        const dangling = {
            id: "model-dangling",
            name: "model-dangling",
            providerId: "provider-does-not-exist",
            upstreamModelId: "gpt-4o-mini",
            type: "chat",
            defaultParams: {},
            contextWindow: null,
            maxTokens: null,
            outputDimension: null,
            pricing: null,
            description: null,
            knowledgeDate: null,
            timeout: 3600,
            maxRetries: 2,
            httpProxy: null,
            enabled: true,
            apiVariantId: null,
            discoveredMetadata: null,
            createdAt: now,
            updatedAt: now,
        };
        db.$client.pragma("foreign_keys = OFF");
        try {
            db.insert(schema.models).values(dangling).run();
        } finally {
            db.$client.pragma("foreign_keys = ON");
        }

        await expect(resolveModel(dangling.name)).rejects.toMatchObject({
            status: 404,
            message: `Provider for model "${dangling.name}" not found`,
        });
    });

    it("throws 400 when the provider is disabled", async () => {
        const provider = seedProvider({ enabled: false });
        const model = seedModel({ providerId: provider.id });
        await expect(resolveModel(model.name)).rejects.toMatchObject({
            status: 400,
            message: `Provider "${provider.name}" is disabled`,
        });
    });

    it("DB hit with null discoveredMetadata + warm discovery cache: uses the cached raw entry", async () => {
        const provider = seedProvider({ adapterId: "openai" });
        const fetchMock = mockFetch();
        fetchMock.mockResolvedValueOnce(
            jsonResponse({ data: [{ id: "gpt-4o-mini", owned_by: "cache-owner" }] }),
        );
        // Warm the in-memory discovery cache for this provider before
        // resolveModel runs — otherwise getDiscoveryStatus() sees nothing.
        await discoveredForProvider(provider);
        expect(fetchMock).toHaveBeenCalledTimes(1);

        const model = seedModel({
            providerId: provider.id,
            upstreamModelId: "gpt-4o-mini",
            discoveredMetadata: null,
        });

        const resolved = await resolveModel(model.name);

        expect(resolved.meta?.upstream_id).toBe("gpt-4o-mini");
        expect(resolved.meta?.owned_by).toBe("cache-owner");
        // resolveModel must not re-fetch — it only reads the warm cache.
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("DB hit with null discoveredMetadata + cache miss for this model id: falls back to {id}", async () => {
        const provider = seedProvider({ adapterId: "openai" });
        const fetchMock = mockFetch();
        fetchMock.mockResolvedValueOnce(
            jsonResponse({ data: [{ id: "some-other-model", owned_by: "irrelevant" }] }),
        );
        await discoveredForProvider(provider);

        const model = seedModel({
            providerId: provider.id,
            upstreamModelId: "totally-unlisted-model",
            discoveredMetadata: null,
        });

        const resolved = await resolveModel(model.name);
        expect(resolved.meta?.upstream_id).toBe("totally-unlisted-model");
        expect(resolved.meta?.owned_by).toBeNull();
    });

    it("DB hit with null discoveredMetadata + no cache warmed at all: falls back to {id}", async () => {
        const provider = seedProvider({ adapterId: "openai" });
        const model = seedModel({
            providerId: provider.id,
            upstreamModelId: "cold-cache-model",
            discoveredMetadata: null,
        });

        const resolved = await resolveModel(model.name);
        expect(resolved.meta?.upstream_id).toBe("cold-cache-model");
        expect(resolved.discovered).toBe(false);
    });

    it("discovery fallback: model absent from DB resolves through resolveByDiscovery as a transient Model", async () => {
        const provider = seedProvider({ adapterId: "openai" });
        const fetchMock = mockFetch();
        fetchMock.mockResolvedValueOnce(
            jsonResponse({ data: [{ id: "discovered-only-model", owned_by: "acme" }] }),
        );

        const resolved = await resolveModel("discovered-only-model");

        expect(resolved.discovered).toBe(true);
        expect(resolved.provider.id).toBe(provider.id);
        expect(resolved.model.id).toBe(`discovered:${provider.id}:discovered-only-model`);
        expect(resolved.model.upstreamModelId).toBe("discovered-only-model");
        // Not a chat/embedding/etc. name match -> DEFAULT_CAPABILITY_ID.
        expect(resolved.model.type).toBe("chat");
        expect(resolved.model.enabled).toBe(true);
        expect(resolved.model.timeout).toBe(3600);
        expect(resolved.model.maxRetries).toBe(2);
        expect(resolved.model.apiVariantId).toBeNull();
        expect(resolved.model.discoveredMetadata).toBeNull();
        expect(resolved.meta?.owned_by).toBe("acme");
    });

    it("discovery fallback derives capability from the discovered model id (embedding)", async () => {
        seedProvider({ adapterId: "openai" });
        const fetchMock = mockFetch();
        fetchMock.mockResolvedValueOnce(
            jsonResponse({ data: [{ id: "text-embedding-3-small" }] }),
        );
        const resolved = await resolveModel("text-embedding-3-small");
        expect(resolved.model.type).toBe("embedding");
    });

    it("throws 404 when the model is neither a DB row nor discoverable anywhere", async () => {
        seedProvider({ adapterId: "openai" });
        const fetchMock = mockFetch();
        fetchMock.mockResolvedValueOnce(jsonResponse({ data: [] }));
        await expect(resolveModel("nowhere-to-be-found")).rejects.toMatchObject({
            status: 404,
            message: 'Model "nowhere-to-be-found" not found in any provider',
        });
    });
});
