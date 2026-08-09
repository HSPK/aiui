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

import { GET as statsGET } from "@/app/api/stats/route";
import { GET as modelStatsGET } from "@/app/api/stats/models/[name]/route";
import { resetDb, seedAdmin, seedLog, seedModel, seedProvider, seedUser } from "../../helpers/db";
import { asAdmin, asAnon, asUser, ctx, envelope, getReq, mockDiscoveryFetch, toSessionUser } from "./_helpers";

describe("GET /api/stats", () => {
    beforeEach(() => {
        resetDb();
        mockDiscoveryFetch();
    });

    it("401s anonymous callers", async () => {
        asAnon();
        const res = await statsGET(getReq("/api/stats"));
        expect(res.status).toBe(401);
    });

    it("400s an invalid query (days out of range)", async () => {
        const user = seedUser();
        asUser(toSessionUser(user));
        const res = await statsGET(getReq("/api/stats?days=0"));
        expect(res.status).toBe(400);
    });

    it("scopes a regular user's overview to their own logs only", async () => {
        const userA = seedUser({ username: "stats-a" });
        const userB = seedUser({ username: "stats-b" });
        seedLog({ userId: userA.id, modelName: "model-a", status: "completed" });
        seedLog({ userId: userB.id, modelName: "model-b", status: "completed" });

        asUser(toSessionUser(userA));
        const res = await statsGET(getReq("/api/stats"));
        expect(res.status).toBe(200);
        const body = await envelope<{ totals: { requests: number }; by_model: { key: string }[] }>(res);
        expect(body.data.totals.requests).toBe(1);
        expect(body.data.by_model.map((m) => m.key)).toEqual(["model-a"]);
    });

    it("ignores a non-admin's user_id param — no cross-user data leak via the query string", async () => {
        const userA = seedUser({ username: "stats-c" });
        const userB = seedUser({ username: "stats-d" });
        seedLog({ userId: userA.id, modelName: "model-a" });
        seedLog({ userId: userB.id, modelName: "model-b" });

        asUser(toSessionUser(userA));
        const res = await statsGET(getReq(`/api/stats?user_id=${userB.id}`));
        expect(res.status).toBe(200);
        const body = await envelope<{ totals: { requests: number } }>(res);
        // Still scoped to caller's own 1 log, NOT userB's.
        expect(body.data.totals.requests).toBe(1);
    });

    it("lets an admin see every user's logs by default, or scope to one via user_id", async () => {
        const admin = seedAdmin();
        const userA = seedUser({ username: "stats-e" });
        const userB = seedUser({ username: "stats-f" });
        seedLog({ userId: userA.id, modelName: "model-a" });
        seedLog({ userId: userB.id, modelName: "model-b" });

        asAdmin(toSessionUser(admin));
        const allRes = await statsGET(getReq("/api/stats"));
        const allBody = await envelope<{ totals: { requests: number } }>(allRes);
        expect(allBody.data.totals.requests).toBe(2);

        const scopedRes = await statsGET(getReq(`/api/stats?user_id=${userA.id}`));
        const scopedBody = await envelope<{ totals: { requests: number } }>(scopedRes);
        expect(scopedBody.data.totals.requests).toBe(1);
    });

    it("computes totals/failed/completed correctly across statuses", async () => {
        const user = seedUser();
        seedLog({ userId: user.id, status: "completed" });
        seedLog({ userId: user.id, status: "failed" });
        seedLog({ userId: user.id, status: "pending" });
        asUser(toSessionUser(user));

        const res = await statsGET(getReq("/api/stats"));
        const body = await envelope<{ totals: { requests: number; completed: number; failed: number; pending: number } }>(
            res,
        );
        expect(body.data.totals).toMatchObject({ requests: 3, completed: 1, failed: 1, pending: 1 });
    });

    it("excludes soft-deleted logs", async () => {
        const user = seedUser();
        seedLog({ userId: user.id, isDeleted: true });
        asUser(toSessionUser(user));
        const res = await statsGET(getReq("/api/stats"));
        const body = await envelope<{ totals: { requests: number } }>(res);
        expect(body.data.totals.requests).toBe(0);
    });
});

describe("GET /api/stats/models/[name]", () => {
    beforeEach(() => {
        resetDb();
        mockDiscoveryFetch();
    });

    it("401s anonymous callers", async () => {
        asAnon();
        const res = await modelStatsGET(getReq("/api/stats/models/gpt-4o"), ctx({ name: "gpt-4o" }));
        expect(res.status).toBe(401);
    });

    it("400s an invalid query", async () => {
        const user = seedUser();
        asUser(toSessionUser(user));
        const res = await modelStatsGET(getReq("/api/stats/models/gpt-4o?days=999"), ctx({ name: "gpt-4o" }));
        expect(res.status).toBe(400);
    });

    it("returns null meta fields for a model with no catalog entry (deleted/unknown)", async () => {
        const user = seedUser();
        asUser(toSessionUser(user));
        const res = await modelStatsGET(getReq("/api/stats/models/ghost-model"), ctx({ name: "ghost-model" }));
        expect(res.status).toBe(200);
        const body = await envelope<{ model_name: string; provider: string | null; capability: string | null }>(res);
        expect(body.data.model_name).toBe("ghost-model");
        expect(body.data.provider).toBeNull();
        expect(body.data.capability).toBeNull();
    });

    it("resolves provider/capability meta for a catalogued model and scopes stats to the caller", async () => {
        const user = seedUser();
        const provider = seedProvider({ name: "stats-provider" });
        seedModel({ providerId: provider.id, name: "catalogued-model", type: "chat" });
        seedLog({ userId: user.id, modelName: "catalogued-model" });
        asUser(toSessionUser(user));

        const res = await modelStatsGET(getReq("/api/stats/models/catalogued-model"), ctx({ name: "catalogued-model" }));
        expect(res.status).toBe(200);
        const body = await envelope<{ provider: string | null; capability: string | null; totals: { requests: number } }>(
            res,
        );
        expect(body.data.provider).toBe("stats-provider");
        expect(body.data.capability).toBe("chat");
        expect(body.data.totals.requests).toBe(1);
    });

    it("does not leak another user's per-model logs to a regular user", async () => {
        const userA = seedUser({ username: "modelstats-a" });
        const userB = seedUser({ username: "modelstats-b" });
        seedLog({ userId: userB.id, modelName: "shared-model-name" });
        asUser(toSessionUser(userA));

        const res = await modelStatsGET(
            getReq("/api/stats/models/shared-model-name"),
            ctx({ name: "shared-model-name" }),
        );
        const body = await envelope<{ totals: { requests: number } }>(res);
        expect(body.data.totals.requests).toBe(0);
    });
});
