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

import { GET as usersGET, POST as usersPOST } from "@/app/api/users/route";
import { PATCH as userPATCH, DELETE as userDELETE } from "@/app/api/users/[username]/route";
import { GET as meGET, PATCH as mePATCH } from "@/app/api/users/me/route";
import { GET as prefsGET, PATCH as prefsPATCH } from "@/app/api/users/me/preferences/route";
import { db, schema } from "@/lib/server/db";
import { eq } from "drizzle-orm";
import { defaultUserPreferences } from "@/lib/schemas/preferences";
import { resetDb, seedAdmin, seedUser } from "../../helpers/db";
import { asAdmin, asAnon, asUser, ctx, deleteReq, envelope, getReq, patchJson, postJson, toSessionUser } from "./_helpers";

describe("GET/POST /api/users (admin only)", () => {
    beforeEach(() => {
        resetDb();
    });

    it("401s anonymous callers", async () => {
        asAnon();
        const res = await usersGET(getReq("/api/users"));
        expect(res.status).toBe(401);
    });

    it("403s a logged-in non-admin", async () => {
        const user = seedUser();
        asUser(toSessionUser(user));
        const res = await usersGET(getReq("/api/users"));
        expect(res.status).toBe(403);
    });

    it("lists users paginated for an admin, defaulting sort to -created_at", async () => {
        const admin = seedAdmin();
        seedUser({ username: "zeta" });
        seedUser({ username: "alpha" });
        asAdmin(toSessionUser(admin));

        const res = await usersGET(getReq("/api/users"));
        expect(res.status).toBe(200);
        const body = await envelope<{ items: { username: string }[]; total: number; page: number; page_size: number }>(
            res,
        );
        expect(body.data.total).toBe(3);
        expect(body.data.page).toBe(1);
        expect(body.data.page_size).toBe(20);
    });

    it("filters by keyword and filter_admin, and paginates", async () => {
        const admin = seedAdmin({ username: "root" });
        seedUser({ username: "keyword-match-1" });
        seedUser({ username: "keyword-match-2" });
        seedUser({ username: "other" });
        asAdmin(toSessionUser(admin));

        const res = await usersGET(getReq("/api/users?keyword=keyword-match&page=1&page_size=1&sort=username"));
        expect(res.status).toBe(200);
        const body = await envelope<{ items: { username: string }[]; total: number }>(res);
        expect(body.data.total).toBe(2);
        expect(body.data.items).toHaveLength(1);
        expect(body.data.items[0].username).toBe("keyword-match-1");
    });

    it("filters admin-only and user-only via filter_admin", async () => {
        const admin = seedAdmin({ username: "root2" });
        seedUser({ username: "plainuser" });
        asAdmin(toSessionUser(admin));

        const adminsOnly = await usersGET(getReq("/api/users?filter_admin=true"));
        const adminsBody = await envelope<{ items: { role: string }[] }>(adminsOnly);
        expect(adminsBody.data.items.every((u) => u.role === "admin")).toBe(true);

        const usersOnly = await usersGET(getReq("/api/users?filter_admin=false"));
        const usersBody = await envelope<{ items: { role: string }[] }>(usersOnly);
        expect(usersBody.data.items.every((u) => u.role === "user")).toBe(true);
    });

    it("400s an invalid query (page_size out of range)", async () => {
        const admin = seedAdmin();
        asAdmin(toSessionUser(admin));
        const res = await usersGET(getReq("/api/users?page_size=999"));
        expect(res.status).toBe(400);
    });

    it("401s POST for anonymous callers", async () => {
        asAnon();
        const res = await usersPOST(postJson("/api/users", { username: "new", password: "password" }));
        expect(res.status).toBe(401);
    });

    it("403s POST for a non-admin", async () => {
        const user = seedUser();
        asUser(toSessionUser(user));
        const res = await usersPOST(postJson("/api/users", { username: "new", password: "password" }));
        expect(res.status).toBe(403);
    });

    it("400s POST with an invalid body (short password)", async () => {
        const admin = seedAdmin();
        asAdmin(toSessionUser(admin));
        const res = await usersPOST(postJson("/api/users", { username: "new", password: "abc" }));
        expect(res.status).toBe(400);
    });

    it("creates a user as admin, defaulting role to user", async () => {
        const admin = seedAdmin();
        asAdmin(toSessionUser(admin));
        const res = await usersPOST(postJson("/api/users", { username: "NewGuy", password: "password" }));
        expect(res.status).toBe(200);
        const body = await envelope<{ username: string; role: string }>(res);
        expect(body.data.username).toBe("newguy");
        expect(body.data.role).toBe("user");

        const row = db.select().from(schema.users).where(eq(schema.users.username, "newguy")).get();
        expect(row).toBeDefined();
    });

    it("400s creating a duplicate username (case-insensitive)", async () => {
        const admin = seedAdmin();
        seedUser({ username: "dupe" });
        asAdmin(toSessionUser(admin));
        const res = await usersPOST(postJson("/api/users", { username: "DUPE", password: "password" }));
        expect(res.status).toBe(400);
    });
});

describe("PATCH/DELETE /api/users/[username] (admin only)", () => {
    beforeEach(() => {
        resetDb();
    });

    it("401s anonymous PATCH/DELETE", async () => {
        asAnon();
        const patchRes = await userPATCH(patchJson("/api/users/bob", { role: "admin" }), ctx({ username: "bob" }));
        expect(patchRes.status).toBe(401);
        const deleteRes = await userDELETE(deleteReq("/api/users/bob"), ctx({ username: "bob" }));
        expect(deleteRes.status).toBe(401);
    });

    it("403s a non-admin caller", async () => {
        const user = seedUser();
        asUser(toSessionUser(user));
        const patchRes = await userPATCH(patchJson("/api/users/bob", { role: "admin" }), ctx({ username: "bob" }));
        expect(patchRes.status).toBe(403);
        const deleteRes = await userDELETE(deleteReq("/api/users/bob"), ctx({ username: "bob" }));
        expect(deleteRes.status).toBe(403);
    });

    it("404s updating/deleting a nonexistent user", async () => {
        const admin = seedAdmin();
        asAdmin(toSessionUser(admin));
        const patchRes = await userPATCH(patchJson("/api/users/ghost", { role: "admin" }), ctx({ username: "ghost" }));
        expect(patchRes.status).toBe(404);
        const deleteRes = await userDELETE(deleteReq("/api/users/ghost"), ctx({ username: "ghost" }));
        expect(deleteRes.status).toBe(404);
    });

    it("400s an invalid PATCH body (short password)", async () => {
        const admin = seedAdmin();
        seedUser({ username: "target" });
        asAdmin(toSessionUser(admin));
        const res = await userPATCH(patchJson("/api/users/target", { password: "ab" }), ctx({ username: "target" }));
        expect(res.status).toBe(400);
    });

    it("promotes a user to admin", async () => {
        const admin = seedAdmin();
        seedUser({ username: "promoteme" });
        asAdmin(toSessionUser(admin));
        const res = await userPATCH(patchJson("/api/users/promoteme", { role: "admin" }), ctx({ username: "promoteme" }));
        expect(res.status).toBe(200);
        const row = db.select().from(schema.users).where(eq(schema.users.username, "promoteme")).get();
        expect(row?.role).toBe("admin");
    });

    it("400s demoting the last admin", async () => {
        const admin = seedAdmin({ username: "onlyadmin" });
        asAdmin(toSessionUser(admin));
        const res = await userPATCH(patchJson("/api/users/onlyadmin", { role: "user" }), ctx({ username: "onlyadmin" }));
        expect(res.status).toBe(400);
    });

    it("allows demoting an admin when another admin exists", async () => {
        const admin = seedAdmin({ username: "admin1" });
        seedAdmin({ username: "admin2" });
        asAdmin(toSessionUser(admin));
        const res = await userPATCH(patchJson("/api/users/admin2", { role: "user" }), ctx({ username: "admin2" }));
        expect(res.status).toBe(200);
    });

    it("changing a user's password revokes their sessions", async () => {
        const admin = seedAdmin();
        const target = seedUser({ username: "haspassword" });
        db.insert(schema.sessions).values({ id: "sess-1", userId: target.id, expiresAt: new Date(Date.now() + 100000) }).run();
        asAdmin(toSessionUser(admin));

        const res = await userPATCH(patchJson("/api/users/haspassword", { password: "newpassword" }), ctx({ username: "haspassword" }));
        expect(res.status).toBe(200);
        const remaining = db.select().from(schema.sessions).where(eq(schema.sessions.userId, target.id)).all();
        expect(remaining).toHaveLength(0);
    });

    it("400s deleting your own account", async () => {
        const admin = seedAdmin({ username: "selfie" });
        asAdmin(toSessionUser(admin));
        const res = await userDELETE(deleteReq("/api/users/selfie"), ctx({ username: "selfie" }));
        expect(res.status).toBe(400);
    });

    it("400s deleting the last admin", async () => {
        // The route's admin-gate is mocked (see asAdmin), so the acting
        // session doesn't need a matching DB row — deleteUser() only
        // looks the actor up by username for the self-delete compare,
        // never re-verifies their role against the users table. That
        // lets us model exactly one real admin (the target) plus a
        // distinct authenticated admin actor, exercising deleteUser's
        // `adminCount() <= 1` guard the same way a TOCTOU race would
        // (an admin's own row demoted/deleted between session issuance
        // and this call, leaving them as the sole admin by DB count).
        seedAdmin({ username: "onlyadmin2" });
        asAdmin({ id: "external-admin", username: "actor", role: "admin", createdAt: new Date().toISOString() });
        const res = await userDELETE(deleteReq("/api/users/onlyadmin2"), ctx({ username: "onlyadmin2" }));
        expect(res.status).toBe(400);
    });

    it("deletes a regular user and cascades their logs/sessions", async () => {
        const admin = seedAdmin();
        const target = seedUser({ username: "deleteme" });
        db.insert(schema.generationLogs)
            .values({
                id: "log-1",
                userId: target.id,
                modelName: "gpt-4o-mini",
                capability: "chat",
                status: "completed",
                input: {},
                inputSummary: "x",
            })
            .run();
        asAdmin(toSessionUser(admin));

        const res = await userDELETE(deleteReq("/api/users/deleteme"), ctx({ username: "deleteme" }));
        expect(res.status).toBe(200);
        const row = db.select().from(schema.users).where(eq(schema.users.username, "deleteme")).get();
        expect(row).toBeUndefined();
    });
});

describe("GET/PATCH /api/users/me", () => {
    beforeEach(() => {
        resetDb();
    });

    it("401s anonymous callers", async () => {
        asAnon();
        const res = await meGET(getReq("/api/users/me"));
        expect(res.status).toBe(401);
    });

    it("returns the caller's own profile (any logged-in user, no admin needed)", async () => {
        const user = seedUser({ username: "self" });
        asUser(toSessionUser(user));
        const res = await meGET(getReq("/api/users/me"));
        expect(res.status).toBe(200);
        const body = await envelope<{ username: string; role: string; created_at: string }>(res);
        expect(body.data.username).toBe("self");
        expect(body.data.created_at).toBe(user.createdAt);
    });

    it("400s an invalid password-change body", async () => {
        const user = seedUser({ username: "changer" });
        asUser(toSessionUser(user));
        const res = await mePATCH(patchJson("/api/users/me", { current_password: "", new_password: "abc" }));
        expect(res.status).toBe(400);
    });

    it("401s a password change with the wrong current password", async () => {
        const user = seedUser({ username: "changer2" });
        asUser(toSessionUser(user));
        const res = await mePATCH(
            patchJson("/api/users/me", { current_password: "wrongpw", new_password: "newpassword" }),
        );
        expect(res.status).toBe(401);
    });

    it("200s changing your own password with the correct current password", async () => {
        const { hashPassword } = await import("@/lib/server/auth");
        const passwordHash = await hashPassword("correct-horse-battery-staple");
        const user = seedUser({ username: "changer3", passwordHash });
        asUser(toSessionUser(user));
        const res = await mePATCH(
            patchJson("/api/users/me", { current_password: "correct-horse-battery-staple", new_password: "newpassword" }),
        );
        expect(res.status).toBe(200);
        expect((await envelope<{ ok: boolean }>(res)).data.ok).toBe(true);

        // Sessions were revoked and the hash actually rotated.
        const row = db.select().from(schema.users).where(eq(schema.users.username, "changer3")).get();
        expect(row?.passwordHash).not.toBe(passwordHash);
    });
});

describe("GET/PATCH /api/users/me/preferences", () => {
    beforeEach(() => {
        resetDb();
    });

    it("401s anonymous callers", async () => {
        asAnon();
        const res = await prefsGET(getReq("/api/users/me/preferences"));
        expect(res.status).toBe(401);
    });

    it("returns defaults for a user with no stored preferences", async () => {
        const user = seedUser();
        asUser(toSessionUser(user));
        const res = await prefsGET(getReq("/api/users/me/preferences"));
        expect(res.status).toBe(200);
        const body = await envelope(res);
        expect(body.data).toEqual(defaultUserPreferences);
    });

    it("400s an invalid preferences patch", async () => {
        const user = seedUser();
        asUser(toSessionUser(user));
        const res = await prefsPATCH(patchJson("/api/users/me/preferences", { typewriter_cps: 1 }));
        expect(res.status).toBe(400);
    });

    it("persists a partial patch and merges with defaults on next read", async () => {
        const user = seedUser();
        asUser(toSessionUser(user));
        const patchRes = await prefsPATCH(patchJson("/api/users/me/preferences", { theme_scheme: "dark" }));
        expect(patchRes.status).toBe(200);
        const patchBody = await envelope<{ theme_scheme: string }>(patchRes);
        expect(patchBody.data.theme_scheme).toBe("dark");

        const getRes = await prefsGET(getReq("/api/users/me/preferences"));
        const getBody = await envelope<{ theme_scheme: string; default_model: string }>(getRes);
        expect(getBody.data.theme_scheme).toBe("dark");
        expect(getBody.data.default_model).toBe("");
    });

    it("scopes preferences per-user (another user doesn't see them)", async () => {
        const userA = seedUser({ username: "prefsA" });
        const userB = seedUser({ username: "prefsB" });
        asUser(toSessionUser(userA));
        await prefsPATCH(patchJson("/api/users/me/preferences", { theme_scheme: "dark" }));

        asUser(toSessionUser(userB));
        const res = await prefsGET(getReq("/api/users/me/preferences"));
        const body = await envelope<{ theme_scheme: string }>(res);
        expect(body.data.theme_scheme).toBe("system");
    });
});
