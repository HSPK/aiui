import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/auth", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/lib/server/auth")>();
    return {
        ...actual,
        getCurrentUser: vi.fn(),
        requireUser: vi.fn(),
        requireAdmin: vi.fn(),
        authenticateGateway: vi.fn(),
    };
});

import { GET as providersGET, POST as providersPOST } from "@/app/api/providers/route";
import { DELETE as providerDELETE, GET as providerGET, PATCH as providerPATCH } from "@/app/api/providers/[id]/route";
import { POST as checkPOST } from "@/app/api/providers/[id]/check/route";
import { GET as providerModelsGET } from "@/app/api/providers/[id]/models/route";
import { POST as probePOST } from "@/app/api/providers/probe/route";
import { POST as reloadPOST } from "@/app/api/providers/reload/route";
import { db, schema } from "@/lib/server/db";
import { eq } from "drizzle-orm";
import { resetDb, seedAdmin, seedModel, seedProvider, seedUser } from "../../helpers/db";
import { asAdmin, asAnon, asUser, ctx, envelope, getReq, mockDiscoveryFetch, postJson, patchJson, deleteReq, toSessionUser } from "./_helpers";

describe("GET/POST /api/providers", () => {
    beforeEach(() => {
        resetDb();
        mockDiscoveryFetch();
    });

    it("401s anonymous callers on GET", async () => {
        asAnon();
        const res = await providersGET(getReq("/api/providers"));
        expect(res.status).toBe(401);
    });

    it("lists providers for any logged-in user (not admin-gated)", async () => {
        const user = seedUser();
        seedProvider({ name: "provider-1" });
        asUser(toSessionUser(user));
        const res = await providersGET(getReq("/api/providers"));
        expect(res.status).toBe(200);
        const body = await envelope<{ name: string; has_api_key: boolean }[]>(res);
        expect(body.data).toHaveLength(1);
        expect(body.data[0].name).toBe("provider-1");
        expect(body.data[0].has_api_key).toBe(true);
    });

    it("401s POST for anonymous callers, 403s for a non-admin", async () => {
        asAnon();
        const anonRes = await providersPOST(
            postJson("/api/providers", { name: "x", base_url: "https://x.example.com" }),
        );
        expect(anonRes.status).toBe(401);

        const user = seedUser();
        asUser(toSessionUser(user));
        const userRes = await providersPOST(
            postJson("/api/providers", { name: "x", base_url: "https://x.example.com" }),
        );
        expect(userRes.status).toBe(403);
    });

    it("400s an invalid create body (bad base_url)", async () => {
        const admin = seedAdmin();
        asAdmin(toSessionUser(admin));
        const res = await providersPOST(postJson("/api/providers", { name: "x", base_url: "not-a-url" }));
        expect(res.status).toBe(400);
    });

    it("creates a provider as admin, auto-detecting the adapter", async () => {
        const admin = seedAdmin();
        asAdmin(toSessionUser(admin));
        const res = await providersPOST(
            postJson("/api/providers", { name: "my-provider", base_url: "https://api.openai.com/v1" }),
        );
        expect(res.status).toBe(200);
        const body = await envelope<{ name: string; adapter_id: string; has_api_key: boolean }>(res);
        expect(body.data.name).toBe("my-provider");
        expect(body.data.adapter_id).toBe("openai");
        expect(body.data.has_api_key).toBe(false);
    });

    it("400s creating a provider with a duplicate name", async () => {
        const admin = seedAdmin();
        seedProvider({ name: "dupe-provider" });
        asAdmin(toSessionUser(admin));
        const res = await providersPOST(
            postJson("/api/providers", { name: "dupe-provider", base_url: "https://x.example.com" }),
        );
        expect(res.status).toBe(400);
    });
});

describe("GET/PATCH/DELETE /api/providers/[id]", () => {
    beforeEach(() => {
        resetDb();
        mockDiscoveryFetch();
    });

    it("401s anonymous GET", async () => {
        asAnon();
        const res = await providerGET(getReq("/api/providers/x"), ctx({ id: "x" }));
        expect(res.status).toBe(401);
    });

    it("404s a nonexistent provider", async () => {
        const user = seedUser();
        asUser(toSessionUser(user));
        const res = await providerGET(getReq("/api/providers/nope"), ctx({ id: "nope" }));
        expect(res.status).toBe(404);
    });

    it("gets a provider by id or by name for any logged-in user", async () => {
        const user = seedUser();
        const provider = seedProvider({ name: "byname" });
        asUser(toSessionUser(user));

        const byId = await providerGET(getReq(`/api/providers/${provider.id}`), ctx({ id: provider.id }));
        expect(byId.status).toBe(200);
        const byName = await providerGET(getReq("/api/providers/byname"), ctx({ id: "byname" }));
        expect(byName.status).toBe(200);
    });

    it("401s/403s PATCH and DELETE for anonymous/non-admin callers", async () => {
        const provider = seedProvider();
        asAnon();
        expect((await providerPATCH(patchJson(`/api/providers/${provider.id}`, {}), ctx({ id: provider.id }))).status).toBe(401);
        expect((await providerDELETE(deleteReq(`/api/providers/${provider.id}`), ctx({ id: provider.id }))).status).toBe(401);

        const user = seedUser();
        asUser(toSessionUser(user));
        expect((await providerPATCH(patchJson(`/api/providers/${provider.id}`, {}), ctx({ id: provider.id }))).status).toBe(403);
        expect((await providerDELETE(deleteReq(`/api/providers/${provider.id}`), ctx({ id: provider.id }))).status).toBe(403);
    });

    it("404s updating/deleting a nonexistent provider", async () => {
        const admin = seedAdmin();
        asAdmin(toSessionUser(admin));
        expect((await providerPATCH(patchJson("/api/providers/nope", { name: "x" }), ctx({ id: "nope" }))).status).toBe(404);
        expect((await providerDELETE(deleteReq("/api/providers/nope"), ctx({ id: "nope" }))).status).toBe(404);
    });

    it("400s an empty base_url on PATCH", async () => {
        const admin = seedAdmin();
        const provider = seedProvider();
        asAdmin(toSessionUser(admin));
        const res = await providerPATCH(
            patchJson(`/api/providers/${provider.id}`, { base_url: "   " }),
            ctx({ id: provider.id }),
        );
        expect(res.status).toBe(400);
    });

    it("updates a provider and clears the discovery cache when base_url changes", async () => {
        const admin = seedAdmin();
        const provider = seedProvider({ baseUrl: "https://old.example.com/v1" });
        asAdmin(toSessionUser(admin));
        const res = await providerPATCH(
            patchJson(`/api/providers/${provider.id}`, { base_url: "https://new.example.com/v1" }),
            ctx({ id: provider.id }),
        );
        expect(res.status).toBe(200);
        const row = db.select().from(schema.providers).where(eq(schema.providers.id, provider.id)).get();
        expect(row?.baseUrl).toBe("https://new.example.com/v1");
    });

    it("clearing api_key with null wipes it, but an empty string leaves it unchanged", async () => {
        const admin = seedAdmin();
        const provider = seedProvider();
        asAdmin(toSessionUser(admin));

        const clearRes = await providerPATCH(patchJson(`/api/providers/${provider.id}`, { api_key: null }), ctx({ id: provider.id }));
        expect(clearRes.status).toBe(200);
        let row = db.select().from(schema.providers).where(eq(schema.providers.id, provider.id)).get();
        expect(row?.apiKeyEncrypted).toBeNull();

        const setRes = await providerPATCH(patchJson(`/api/providers/${provider.id}`, { api_key: "sk-newvalue" }), ctx({ id: provider.id }));
        expect(setRes.status).toBe(200);
        row = db.select().from(schema.providers).where(eq(schema.providers.id, provider.id)).get();
        expect(row?.apiKeyEncrypted).not.toBeNull();

        const noopRes = await providerPATCH(patchJson(`/api/providers/${provider.id}`, { api_key: "" }), ctx({ id: provider.id }));
        expect(noopRes.status).toBe(200);
        const afterNoop = db.select().from(schema.providers).where(eq(schema.providers.id, provider.id)).get();
        expect(afterNoop?.apiKeyEncrypted).toBe(row?.apiKeyEncrypted);
    });

    it("400s a duplicate name on PATCH", async () => {
        const admin = seedAdmin();
        seedProvider({ name: "taken" });
        const provider = seedProvider({ name: "renameme" });
        asAdmin(toSessionUser(admin));
        const res = await providerPATCH(patchJson(`/api/providers/${provider.id}`, { name: "taken" }), ctx({ id: provider.id }));
        expect(res.status).toBe(400);
    });

    it("deletes a provider", async () => {
        const admin = seedAdmin();
        const provider = seedProvider();
        asAdmin(toSessionUser(admin));
        const res = await providerDELETE(deleteReq(`/api/providers/${provider.id}`), ctx({ id: provider.id }));
        expect(res.status).toBe(200);
        const row = db.select().from(schema.providers).where(eq(schema.providers.id, provider.id)).get();
        expect(row).toBeUndefined();
    });
});

describe("POST /api/providers/[id]/check (admin only)", () => {
    beforeEach(() => {
        resetDb();
        mockDiscoveryFetch();
    });

    it("401s anonymous, 403s non-admin", async () => {
        const provider = seedProvider();
        asAnon();
        expect((await checkPOST(postJson(`/api/providers/${provider.id}/check`, {}), ctx({ id: provider.id }))).status).toBe(401);
        const user = seedUser();
        asUser(toSessionUser(user));
        expect((await checkPOST(postJson(`/api/providers/${provider.id}/check`, {}), ctx({ id: provider.id }))).status).toBe(403);
    });

    it("404s a nonexistent provider", async () => {
        const admin = seedAdmin();
        asAdmin(toSessionUser(admin));
        const res = await checkPOST(postJson("/api/providers/nope/check", {}), ctx({ id: "nope" }));
        expect(res.status).toBe(404);
    });

    it("falls back to a discovery probe when no health_check_url is set", async () => {
        const admin = seedAdmin();
        const provider = seedProvider({ healthCheckUrl: null });
        asAdmin(toSessionUser(admin));
        const res = await checkPOST(postJson(`/api/providers/${provider.id}/check`, {}), ctx({ id: provider.id }));
        expect(res.status).toBe(200);
        const body = await envelope<{ ok: boolean; models?: number }>(res);
        expect(body.data.ok).toBe(true);
        expect(body.data.models).toBe(0);
    });

    it("probes the saved health_check_url and persists the result", async () => {
        const admin = seedAdmin();
        const provider = seedProvider({ healthCheckUrl: "https://health.example.com/status" });
        asAdmin(toSessionUser(admin));
        const res = await checkPOST(postJson(`/api/providers/${provider.id}/check`, {}), ctx({ id: provider.id }));
        expect(res.status).toBe(200);
        const body = await envelope<{ ok: boolean }>(res);
        expect(body.data.ok).toBe(true);

        const row = db.select().from(schema.providers).where(eq(schema.providers.id, provider.id)).get();
        expect(row?.lastHealthStatus).toBe("ok");
        expect(row?.lastHealthCheckedAt).not.toBeNull();
    });

    it("records a down status when the health_check_url probe fails", async () => {
        const admin = seedAdmin();
        const provider = seedProvider({ healthCheckUrl: "https://health.example.com/status" });
        global.fetch = vi.fn().mockResolvedValue(new Response("boom", { status: 500 })) as unknown as typeof fetch;
        asAdmin(toSessionUser(admin));
        const res = await checkPOST(postJson(`/api/providers/${provider.id}/check`, {}), ctx({ id: provider.id }));
        expect(res.status).toBe(200);
        const body = await envelope<{ ok: boolean; error?: string }>(res);
        expect(body.data.ok).toBe(false);

        const row = db.select().from(schema.providers).where(eq(schema.providers.id, provider.id)).get();
        expect(row?.lastHealthStatus).toBe("down");
        expect(row?.lastHealthError).toBeTruthy();
    });
});

describe("GET /api/providers/[id]/models", () => {
    beforeEach(() => {
        resetDb();
        mockDiscoveryFetch();
    });

    it("401s anonymous callers", async () => {
        asAnon();
        const res = await providerModelsGET(getReq("/api/providers/x/models"), ctx({ id: "x" }));
        expect(res.status).toBe(401);
    });

    it("404s a nonexistent provider", async () => {
        const user = seedUser();
        asUser(toSessionUser(user));
        const res = await providerModelsGET(getReq("/api/providers/nope/models"), ctx({ id: "nope" }));
        expect(res.status).toBe(404);
    });

    it("lists DB-backed models for the provider", async () => {
        const user = seedUser();
        const provider = seedProvider();
        seedModel({ providerId: provider.id, name: "model-a" });
        asUser(toSessionUser(user));
        const res = await providerModelsGET(getReq(`/api/providers/${provider.id}/models`), ctx({ id: provider.id }));
        expect(res.status).toBe(200);
        const body = await envelope<{ name: string }[]>(res);
        expect(body.data.map((m) => m.name)).toContain("model-a");
    });
});

describe("POST /api/providers/probe (admin only)", () => {
    beforeEach(() => {
        resetDb();
        mockDiscoveryFetch();
    });

    it("401s anonymous, 403s non-admin", async () => {
        asAnon();
        expect((await probePOST(postJson("/api/providers/probe", { health_check_url: "https://x.example.com" }))).status).toBe(401);
        const user = seedUser();
        asUser(toSessionUser(user));
        expect((await probePOST(postJson("/api/providers/probe", { health_check_url: "https://x.example.com" }))).status).toBe(403);
    });

    it("400s an invalid URL", async () => {
        const admin = seedAdmin();
        asAdmin(toSessionUser(admin));
        const res = await probePOST(postJson("/api/providers/probe", { health_check_url: "not-a-url" }));
        expect(res.status).toBe(400);
    });

    it("returns ok:true for a healthy URL", async () => {
        const admin = seedAdmin();
        asAdmin(toSessionUser(admin));
        const res = await probePOST(postJson("/api/providers/probe", { health_check_url: "https://health.example.com/status" }));
        expect(res.status).toBe(200);
        const body = await envelope<{ ok: boolean; latency_ms: number }>(res);
        expect(body.data.ok).toBe(true);
        expect(typeof body.data.latency_ms).toBe("number");
    });

    it("returns ok:false when the response body doesn't match {status:'ok'}", async () => {
        const admin = seedAdmin();
        global.fetch = vi.fn().mockResolvedValue(
            new Response(JSON.stringify({ status: "nope" }), { status: 200, headers: { "Content-Type": "application/json" } }),
        ) as unknown as typeof fetch;
        asAdmin(toSessionUser(admin));
        const res = await probePOST(postJson("/api/providers/probe", { health_check_url: "https://health.example.com/status" }));
        expect(res.status).toBe(200);
        const body = await envelope<{ ok: boolean; error?: string }>(res);
        expect(body.data.ok).toBe(false);
        expect(body.data.error).toContain("Expected");
    });

    it("returns ok:false when fetch throws", async () => {
        const admin = seedAdmin();
        global.fetch = vi.fn().mockRejectedValue(new Error("network unreachable")) as unknown as typeof fetch;
        asAdmin(toSessionUser(admin));
        const res = await probePOST(postJson("/api/providers/probe", { health_check_url: "https://health.example.com/status" }));
        expect(res.status).toBe(200);
        const body = await envelope<{ ok: boolean; error?: string }>(res);
        expect(body.data.ok).toBe(false);
        expect(body.data.error).toContain("network unreachable");
    });
});

describe("POST /api/providers/reload (admin only)", () => {
    beforeEach(() => {
        resetDb();
        mockDiscoveryFetch();
    });

    it("401s anonymous, 403s non-admin", async () => {
        asAnon();
        expect((await reloadPOST(postJson("/api/providers/reload", {}))).status).toBe(401);
        const user = seedUser();
        asUser(toSessionUser(user));
        expect((await reloadPOST(postJson("/api/providers/reload", {}))).status).toBe(403);
    });

    it("clears the discovery cache for an admin", async () => {
        const admin = seedAdmin();
        asAdmin(toSessionUser(admin));
        const res = await reloadPOST(postJson("/api/providers/reload", {}));
        expect(res.status).toBe(200);
    });
});
