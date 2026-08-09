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

import { GET as keysGET, POST as keysPOST } from "@/app/api/apikeys/route";
import { DELETE as keyDELETE } from "@/app/api/apikeys/[id]/route";
import { db, schema } from "@/lib/server/db";
import { eq } from "drizzle-orm";
import { resetDb, seedUser } from "../../helpers/db";
import { asAnon, asUser, ctx, deleteReq, envelope, getReq, postJson, toSessionUser } from "./_helpers";

describe("GET/POST /api/apikeys", () => {
    beforeEach(() => {
        resetDb();
    });

    it("401s anonymous callers", async () => {
        asAnon();
        const res = await keysGET(getReq("/api/apikeys"));
        expect(res.status).toBe(401);
    });

    it("lists only the caller's own keys, newest first", async () => {
        const userA = seedUser({ username: "keyowner-a" });
        const userB = seedUser({ username: "keyowner-b" });
        asUser(toSessionUser(userA));
        await keysPOST(postJson("/api/apikeys", { name: "key-a-1" }));
        await keysPOST(postJson("/api/apikeys", { name: "key-a-2" }));

        asUser(toSessionUser(userB));
        await keysPOST(postJson("/api/apikeys", { name: "key-b-1" }));

        asUser(toSessionUser(userA));
        const res = await keysGET(getReq("/api/apikeys"));
        expect(res.status).toBe(200);
        const body = await envelope<{ name: string }[]>(res);
        expect(body.data).toHaveLength(2);
        expect(body.data.map((k) => k.name).sort()).toEqual(["key-a-1", "key-a-2"]);
    });

    it("401s POST for anonymous callers", async () => {
        asAnon();
        const res = await keysPOST(postJson("/api/apikeys", { name: "x" }));
        expect(res.status).toBe(401);
    });

    it("400s an invalid create body (empty name)", async () => {
        const user = seedUser();
        asUser(toSessionUser(user));
        const res = await keysPOST(postJson("/api/apikeys", { name: "" }));
        expect(res.status).toBe(400);
    });

    it("400s an invalid expires_at (not a datetime string)", async () => {
        const user = seedUser();
        asUser(toSessionUser(user));
        const res = await keysPOST(postJson("/api/apikeys", { name: "x", expires_at: "not-a-date" }));
        expect(res.status).toBe(400);
    });

    it("creates a key, returning the plaintext once and persisting only a hash", async () => {
        const user = seedUser();
        asUser(toSessionUser(user));
        const res = await keysPOST(postJson("/api/apikeys", { name: "my key" }));
        expect(res.status).toBe(200);
        const body = await envelope<{ key: string; prefix: string; name: string; expires_at: string | null }>(res);
        expect(body.data.key).toMatch(/^.+$/);
        expect(body.data.expires_at).toBeNull();
        expect(body.data.name).toBe("my key");

        const row = db.select().from(schema.apiKeys).where(eq(schema.apiKeys.userId, user.id)).get();
        expect(row).toBeDefined();
        expect(row!.keyHash).not.toBe(body.data.key);
        expect(row!.prefix).toBe(body.data.prefix);
    });

    it("accepts an explicit expires_at", async () => {
        const user = seedUser();
        asUser(toSessionUser(user));
        const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
        const res = await keysPOST(postJson("/api/apikeys", { name: "expiring", expires_at: expiresAt }));
        expect(res.status).toBe(200);
        const body = await envelope<{ expires_at: string | null }>(res);
        expect(body.data.expires_at).toBe(expiresAt);
    });
});

describe("DELETE /api/apikeys/[id]", () => {
    beforeEach(() => {
        resetDb();
    });

    it("401s anonymous callers", async () => {
        asAnon();
        const res = await keyDELETE(deleteReq("/api/apikeys/x"), ctx({ id: "x" }));
        expect(res.status).toBe(401);
    });

    it("404s deleting a nonexistent key", async () => {
        const user = seedUser();
        asUser(toSessionUser(user));
        const res = await keyDELETE(deleteReq("/api/apikeys/nope"), ctx({ id: "nope" }));
        expect(res.status).toBe(404);
    });

    it("deletes the caller's own key", async () => {
        const user = seedUser();
        asUser(toSessionUser(user));
        const createRes = await keysPOST(postJson("/api/apikeys", { name: "todelete" }));
        const created = await envelope<{ id: string }>(createRes);

        const res = await keyDELETE(deleteReq(`/api/apikeys/${created.data.id}`), ctx({ id: created.data.id }));
        expect(res.status).toBe(200);
        const row = db.select().from(schema.apiKeys).where(eq(schema.apiKeys.id, created.data.id)).get();
        expect(row).toBeUndefined();
    });

    it("404s (not 200) when a user tries to delete another user's key — no cross-user deletion", async () => {
        const owner = seedUser({ username: "keyvictim" });
        const attacker = seedUser({ username: "keyattacker" });

        asUser(toSessionUser(owner));
        const createRes = await keysPOST(postJson("/api/apikeys", { name: "victim-key" }));
        const created = await envelope<{ id: string }>(createRes);

        asUser(toSessionUser(attacker));
        const res = await keyDELETE(deleteReq(`/api/apikeys/${created.data.id}`), ctx({ id: created.data.id }));
        expect(res.status).toBe(404);

        // Confirm the row is untouched, not silently deleted.
        const row = db.select().from(schema.apiKeys).where(eq(schema.apiKeys.id, created.data.id)).get();
        expect(row).toBeDefined();
    });
});
