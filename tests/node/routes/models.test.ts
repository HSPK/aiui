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

import { GET as modelsGET, POST as modelsPOST } from "@/app/api/models/route";
import { DELETE as modelDELETE, GET as modelGET, PATCH as modelPATCH } from "@/app/api/models/[id]/route";
import { db, schema } from "@/lib/server/db";
import { eq } from "drizzle-orm";
import { resetDb, seedAdmin, seedModel, seedProvider, seedUser } from "../../helpers/db";
import { asAdmin, asAnon, asUser, ctx, deleteReq, envelope, getReq, mockDiscoveryFetch, patchJson, postJson, toSessionUser } from "./_helpers";

describe("GET/POST /api/models", () => {
    beforeEach(() => {
        resetDb();
        mockDiscoveryFetch();
    });

    it("401s anonymous callers on GET", async () => {
        asAnon();
        const res = await modelsGET(getReq("/api/models"));
        expect(res.status).toBe(401);
    });

    it("lists all DB-backed models for any logged-in user (not admin-gated)", async () => {
        const user = seedUser();
        const provider = seedProvider();
        seedModel({ providerId: provider.id, name: "model-a", type: "chat" });
        asUser(toSessionUser(user));
        const res = await modelsGET(getReq("/api/models"));
        expect(res.status).toBe(200);
        const body = await envelope<{ name: string; is_discovered?: boolean }[]>(res);
        const found = body.data.find((m) => m.name === "model-a");
        expect(found).toBeDefined();
        expect(found?.is_discovered).toBe(false);
    });

    it("401s POST for anonymous, 403s for a non-admin", async () => {
        const provider = seedProvider();
        asAnon();
        const anonRes = await modelsPOST(
            postJson("/api/models", { name: "m", provider_id: provider.id, upstream_model_id: "gpt-4o" }),
        );
        expect(anonRes.status).toBe(401);

        const user = seedUser();
        asUser(toSessionUser(user));
        const userRes = await modelsPOST(
            postJson("/api/models", { name: "m", provider_id: provider.id, upstream_model_id: "gpt-4o" }),
        );
        expect(userRes.status).toBe(403);
    });

    it("400s an invalid body (missing upstream_model_id)", async () => {
        const admin = seedAdmin();
        const provider = seedProvider();
        asAdmin(toSessionUser(admin));
        const res = await modelsPOST(postJson("/api/models", { name: "m", provider_id: provider.id, upstream_model_id: "" }));
        expect(res.status).toBe(400);
    });

    it("400s creating a model against a nonexistent provider", async () => {
        const admin = seedAdmin();
        asAdmin(toSessionUser(admin));
        const res = await modelsPOST(
            postJson("/api/models", { name: "m", provider_id: "no-such-provider", upstream_model_id: "gpt-4o" }),
        );
        expect(res.status).toBe(400);
    });

    it("creates a model as admin, defaulting type to chat", async () => {
        const admin = seedAdmin();
        const provider = seedProvider();
        asAdmin(toSessionUser(admin));
        const res = await modelsPOST(
            postJson("/api/models", { name: "gpt-4o-alias", provider_id: provider.id, upstream_model_id: "gpt-4o" }),
        );
        expect(res.status).toBe(200);
        const body = await envelope<{ name: string; type: string; provider_id: string }>(res);
        expect(body.data.name).toBe("gpt-4o-alias");
        expect(body.data.type).toBe("chat");
        expect(body.data.provider_id).toBe(provider.id);
    });

    it("400s creating a model with a duplicate name", async () => {
        const admin = seedAdmin();
        const provider = seedProvider();
        seedModel({ providerId: provider.id, name: "dupe-model" });
        asAdmin(toSessionUser(admin));
        const res = await modelsPOST(
            postJson("/api/models", { name: "dupe-model", provider_id: provider.id, upstream_model_id: "gpt-4o" }),
        );
        expect(res.status).toBe(400);
    });
});

describe("GET/PATCH/DELETE /api/models/[id]", () => {
    beforeEach(() => {
        resetDb();
        mockDiscoveryFetch();
    });

    it("401s anonymous GET", async () => {
        asAnon();
        const res = await modelGET(getReq("/api/models/x"), ctx({ id: "x" }));
        expect(res.status).toBe(401);
    });

    it("404s a nonexistent model", async () => {
        const user = seedUser();
        asUser(toSessionUser(user));
        const res = await modelGET(getReq("/api/models/nope"), ctx({ id: "nope" }));
        expect(res.status).toBe(404);
    });

    it("gets a model by id or name for any logged-in user", async () => {
        const user = seedUser();
        const provider = seedProvider();
        const model = seedModel({ providerId: provider.id, name: "getme" });
        asUser(toSessionUser(user));

        const byId = await modelGET(getReq(`/api/models/${model.id}`), ctx({ id: model.id }));
        expect(byId.status).toBe(200);
        const byName = await modelGET(getReq("/api/models/getme"), ctx({ id: "getme" }));
        expect(byName.status).toBe(200);
    });

    it("401s/403s PATCH and DELETE for anonymous/non-admin", async () => {
        const provider = seedProvider();
        const model = seedModel({ providerId: provider.id });
        asAnon();
        expect((await modelPATCH(patchJson(`/api/models/${model.id}`, {}), ctx({ id: model.id }))).status).toBe(401);
        expect((await modelDELETE(deleteReq(`/api/models/${model.id}`), ctx({ id: model.id }))).status).toBe(401);

        const user = seedUser();
        asUser(toSessionUser(user));
        expect((await modelPATCH(patchJson(`/api/models/${model.id}`, {}), ctx({ id: model.id }))).status).toBe(403);
        expect((await modelDELETE(deleteReq(`/api/models/${model.id}`), ctx({ id: model.id }))).status).toBe(403);
    });

    it("404s updating/deleting a nonexistent model", async () => {
        const admin = seedAdmin();
        asAdmin(toSessionUser(admin));
        expect((await modelPATCH(patchJson("/api/models/nope", { name: "x" }), ctx({ id: "nope" }))).status).toBe(404);
        expect((await modelDELETE(deleteReq("/api/models/nope"), ctx({ id: "nope" }))).status).toBe(404);
    });

    it("400s an empty name on PATCH", async () => {
        const admin = seedAdmin();
        const provider = seedProvider();
        const model = seedModel({ providerId: provider.id });
        asAdmin(toSessionUser(admin));
        const res = await modelPATCH(patchJson(`/api/models/${model.id}`, { name: "   " }), ctx({ id: model.id }));
        expect(res.status).toBe(400);
    });

    it("400s renaming to a name already in use", async () => {
        const admin = seedAdmin();
        const provider = seedProvider();
        seedModel({ providerId: provider.id, name: "taken" });
        const model = seedModel({ providerId: provider.id, name: "renameme" });
        asAdmin(toSessionUser(admin));
        const res = await modelPATCH(patchJson(`/api/models/${model.id}`, { name: "taken" }), ctx({ id: model.id }));
        expect(res.status).toBe(400);
    });

    it("400s pointing at a nonexistent provider on PATCH", async () => {
        const admin = seedAdmin();
        const provider = seedProvider();
        const model = seedModel({ providerId: provider.id });
        asAdmin(toSessionUser(admin));
        const res = await modelPATCH(
            patchJson(`/api/models/${model.id}`, { provider_id: "no-such-provider" }),
            ctx({ id: model.id }),
        );
        expect(res.status).toBe(400);
    });

    it("updates a model's fields and drops its discovered_metadata snapshot when upstream_model_id changes", async () => {
        const admin = seedAdmin();
        const provider = seedProvider();
        const model = seedModel({
            providerId: provider.id,
            upstreamModelId: "gpt-4o",
            discoveredMetadata: { id: "gpt-4o", stale: true },
        });
        asAdmin(toSessionUser(admin));
        const res = await modelPATCH(
            patchJson(`/api/models/${model.id}`, { upstream_model_id: "gpt-4o-mini" }),
            ctx({ id: model.id }),
        );
        expect(res.status).toBe(200);
        const row = db.select().from(schema.models).where(eq(schema.models.id, model.id)).get();
        expect(row?.upstreamModelId).toBe("gpt-4o-mini");
        expect(row?.discoveredMetadata).toBeNull();
    });

    it("deletes a model", async () => {
        const admin = seedAdmin();
        const provider = seedProvider();
        const model = seedModel({ providerId: provider.id });
        asAdmin(toSessionUser(admin));
        const res = await modelDELETE(deleteReq(`/api/models/${model.id}`), ctx({ id: model.id }));
        expect(res.status).toBe(200);
        const row = db.select().from(schema.models).where(eq(schema.models.id, model.id)).get();
        expect(row).toBeUndefined();
    });
});
