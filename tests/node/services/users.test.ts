import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/server/db";
import { HttpError } from "@/lib/server/response";
import { hashPassword, verifyPassword } from "@/lib/server/auth";
import {
    changeOwnPassword,
    createUser,
    deleteUser,
    listUsers,
    normalizeUsername,
    serializeUser,
    updateUser,
} from "@/lib/server/users";
import { resetDb, seedAdmin, seedUser } from "../../helpers/db";
import type { Session } from "@/lib/server/db/schema";

function seedSession(userId: string, overrides: Partial<Session> = {}): Session {
    const row: Session = {
        id: overrides.id ?? crypto.randomUUID(),
        userId,
        expiresAt: overrides.expiresAt ?? new Date(Date.now() + 3_600_000),
        createdAt: overrides.createdAt ?? new Date().toISOString(),
    };
    db.insert(schema.sessions).values(row).run();
    return row;
}

async function expectHttpError(fn: () => unknown, status: number, msgIncludes?: string) {
    try {
        await fn();
        throw new Error("expected function to throw");
    } catch (err) {
        expect(err).toBeInstanceOf(HttpError);
        const httpErr = err as HttpError;
        expect(httpErr.status).toBe(status);
        if (msgIncludes) expect(httpErr.message).toContain(msgIncludes);
    }
}

describe("users service", () => {
    beforeEach(() => resetDb());

    describe("normalizeUsername / serializeUser", () => {
        it("trims and lowercases", () => {
            expect(normalizeUsername("  Alice  ")).toBe("alice");
            expect(normalizeUsername("BOB")).toBe("bob");
        });

        it("serializes a DB row to the wire DTO shape", () => {
            const u = seedUser({ username: "carl", role: "admin", createdAt: "2024-01-01T00:00:00.000Z" });
            expect(serializeUser(u)).toEqual({ username: "carl", role: "admin", created_at: "2024-01-01T00:00:00.000Z" });
        });
    });

    describe("createUser", () => {
        it("creates a user and hashes the password (never stores plaintext)", async () => {
            const dto = await createUser({ username: "newbie", password: "password123", role: "user" });
            expect(dto).toEqual({ username: "newbie", role: "user", created_at: expect.any(String) });

            const row = db.select().from(schema.users).where(eqUsername("newbie")).get()!;
            expect(row.passwordHash).not.toBe("password123");
            expect(row.passwordHash.startsWith("$2")).toBe(true);
            expect(await verifyPassword("password123", row.passwordHash)).toBe(true);
        });

        it("normalizes the username casing at write time", async () => {
            await createUser({ username: "  MixedCase  ", password: "password123", role: "user" });
            const row = db.select().from(schema.users).where(eqUsername("mixedcase")).get();
            expect(row).toBeTruthy();
        });

        it("rejects an empty (post-trim) username with 400", async () => {
            await expectHttpError(() => createUser({ username: "   ", password: "password123", role: "user" }), 400, "empty");
        });

        it("rejects a duplicate username (case-insensitive) with 400", async () => {
            seedUser({ username: "taken" });
            await expectHttpError(
                () => createUser({ username: "Taken", password: "password123", role: "user" }),
                400,
                "already exists",
            );
        });

        it("creating the same brand-new username concurrently: exactly one wins, the loser gets a clean 400", async () => {
            const input = { username: "racer", password: "password123", role: "user" as const };
            const results = await Promise.allSettled([createUser(input), createUser(input)]);
            const fulfilled = results.filter((r) => r.status === "fulfilled");
            const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
            expect(fulfilled).toHaveLength(1);
            expect(rejected).toHaveLength(1);
            expect(rejected[0].reason).toBeInstanceOf(HttpError);
            expect((rejected[0].reason as HttpError).status).toBe(400);
            expect((rejected[0].reason as HttpError).message).toContain("already exists");
            // Only one row landed despite two attempts.
            expect(db.select().from(schema.users).where(eqUsername("racer")).all()).toHaveLength(1);
        });

        it("defaults created_at to an ISO string on the returned DTO", async () => {
            const dto = await createUser({ username: "timely", password: "password123", role: "user" });
            expect(() => new Date(dto.created_at!)).not.toThrow();
            expect(Number.isNaN(new Date(dto.created_at!).getTime())).toBe(false);
        });
    });

    describe("listUsers", () => {
        it("paginates results and reports the correct total", () => {
            for (let i = 0; i < 5; i++) seedUser({ username: `user-${i}`, createdAt: new Date(2024, 0, i + 1).toISOString() });
            const page1 = listUsers({ page: 1, page_size: 2, sort: "username" });
            expect(page1.total).toBe(5);
            expect(page1.page).toBe(1);
            expect(page1.page_size).toBe(2);
            expect(page1.items.map((u) => u.username)).toEqual(["user-0", "user-1"]);

            const page3 = listUsers({ page: 3, page_size: 2, sort: "username" });
            expect(page3.items.map((u) => u.username)).toEqual(["user-4"]);
        });

        it("returns an empty page beyond the last page boundary", () => {
            seedUser({ username: "solo" });
            const page = listUsers({ page: 5, page_size: 10, sort: "username" });
            expect(page.items).toEqual([]);
            expect(page.total).toBe(1);
        });

        it("filters by keyword (substring, case-sensitive per SQLite LIKE default collation)", () => {
            seedUser({ username: "alice" });
            seedUser({ username: "bob" });
            seedUser({ username: "alicia" });
            const result = listUsers({ page: 1, page_size: 20, sort: "username", keyword: "ali" });
            expect(result.items.map((u) => u.username).sort()).toEqual(["alice", "alicia"]);
        });

        it("filters by filter_admin=true / false", () => {
            seedAdmin({ username: "root" });
            seedUser({ username: "normal" });
            const admins = listUsers({ page: 1, page_size: 20, sort: "username", filter_admin: "true" });
            expect(admins.items.map((u) => u.username)).toEqual(["root"]);

            const nonAdmins = listUsers({ page: 1, page_size: 20, sort: "username", filter_admin: "false" });
            expect(nonAdmins.items.map((u) => u.username)).toEqual(["normal"]);
        });

        it("sorts by username ascending or descending", () => {
            seedUser({ username: "zoe" });
            seedUser({ username: "amy" });
            const asc = listUsers({ page: 1, page_size: 20, sort: "username" });
            expect(asc.items.map((u) => u.username)).toEqual(["amy", "zoe"]);
            const desc = listUsers({ page: 1, page_size: 20, sort: "-username" });
            expect(desc.items.map((u) => u.username)).toEqual(["zoe", "amy"]);
        });

        it("defaults to sorting by -created_at", () => {
            seedUser({ username: "older", createdAt: "2024-01-01T00:00:00.000Z" });
            seedUser({ username: "newer", createdAt: "2024-06-01T00:00:00.000Z" });
            const result = listUsers({ page: 1, page_size: 20, sort: "-created_at" });
            expect(result.items.map((u) => u.username)).toEqual(["newer", "older"]);
        });

        it("returns an empty list when there are no users", () => {
            const result = listUsers({ page: 1, page_size: 20, sort: "-created_at" });
            expect(result.items).toEqual([]);
            expect(result.total).toBe(0);
        });
    });

    describe("updateUser", () => {
        it("changes the role", async () => {
            seedAdmin({ username: "root" });
            const target = seedUser({ username: "grow" });
            await updateUser("grow", { role: "admin" });
            const row = db.select().from(schema.users).where(eqUsername("grow")).get()!;
            expect(row.role).toBe("admin");
            void target;
        });

        it("changes the password and hashes it", async () => {
            const target = seedUser({ username: "changeling" });
            await updateUser("changeling", { password: "newpassword123" });
            const row = db.select().from(schema.users).where(eqUsername("changeling")).get()!;
            expect(row.passwordHash).not.toBe(target.passwordHash);
            expect(await verifyPassword("newpassword123", row.passwordHash)).toBe(true);
        });

        it("revokes every session for the target user on password change", async () => {
            const target = seedUser({ username: "sessiony" });
            seedSession(target.id);
            seedSession(target.id);
            expect(db.select().from(schema.sessions).where(eqSessionUser(target.id)).all()).toHaveLength(2);

            await updateUser("sessiony", { password: "brandnew123" });
            expect(db.select().from(schema.sessions).where(eqSessionUser(target.id)).all()).toHaveLength(0);
        });

        it("does NOT revoke sessions on a role-only change", async () => {
            seedAdmin({ username: "root" });
            const target = seedUser({ username: "stable" });
            seedSession(target.id);
            await updateUser("stable", { role: "admin" });
            expect(db.select().from(schema.sessions).where(eqSessionUser(target.id)).all()).toHaveLength(1);
        });

        it("throws 404 for a user that doesn't exist", async () => {
            await expectHttpError(() => updateUser("ghost", { role: "admin" }), 404);
        });

        it("refuses to demote the last admin", async () => {
            const onlyAdmin = seedAdmin({ username: "solo-admin" });
            await expectHttpError(() => updateUser("solo-admin", { role: "user" }), 400, "last admin");
            const row = db.select().from(schema.users).where(eqUsername("solo-admin")).get()!;
            expect(row.role).toBe("admin");
            void onlyAdmin;
        });

        it("allows demoting an admin when another admin remains", async () => {
            seedAdmin({ username: "admin-a" });
            seedAdmin({ username: "admin-b" });
            await updateUser("admin-a", { role: "user" });
            const row = db.select().from(schema.users).where(eqUsername("admin-a")).get()!;
            expect(row.role).toBe("user");
        });

        it("is a no-op when no fields are supplied", async () => {
            const target = seedUser({ username: "untouched" });
            await updateUser("untouched", {});
            const row = db.select().from(schema.users).where(eqUsername("untouched")).get()!;
            expect(row.passwordHash).toBe(target.passwordHash);
            expect(row.role).toBe(target.role);
        });
    });

    describe("deleteUser", () => {
        it("deletes a user", async () => {
            seedAdmin({ username: "root" });
            seedUser({ username: "disposable" });
            deleteUser("disposable", "root");
            expect(db.select().from(schema.users).where(eqUsername("disposable")).get()).toBeUndefined();
        });

        it("refuses self-deletion", async () => {
            seedAdmin({ username: "root" });
            expect(() => deleteUser("root", "root")).toThrow(HttpError);
            try {
                deleteUser("root", "root");
            } catch (err) {
                expect((err as HttpError).status).toBe(400);
                expect((err as HttpError).message).toContain("cannot delete your own account");
            }
        });

        it("throws 404 for a user that doesn't exist", () => {
            seedAdmin({ username: "root" });
            expect(() => deleteUser("ghost", "root")).toThrow(HttpError);
            try {
                deleteUser("ghost", "root");
            } catch (err) {
                expect((err as HttpError).status).toBe(404);
            }
        });

        it("refuses to delete the last admin", () => {
            seedAdmin({ username: "solo-admin" });
            seedUser({ username: "someone-else" });
            expect(() => deleteUser("solo-admin", "someone-else")).toThrow(HttpError);
            try {
                deleteUser("solo-admin", "someone-else");
            } catch (err) {
                expect((err as HttpError).status).toBe(400);
                expect((err as HttpError).message).toContain("last admin");
            }
            expect(db.select().from(schema.users).where(eqUsername("solo-admin")).get()).toBeTruthy();
        });

        it("allows deleting an admin when another admin remains", () => {
            seedAdmin({ username: "admin-a" });
            seedAdmin({ username: "admin-b" });
            deleteUser("admin-a", "admin-b");
            expect(db.select().from(schema.users).where(eqUsername("admin-a")).get()).toBeUndefined();
        });

        it("cascades: deleting a user removes their generation logs, conversations and sessions", () => {
            seedAdmin({ username: "root" });
            const target = seedUser({ username: "cascade-me" });
            seedSession(target.id);
            db.insert(schema.conversations).values({
                id: crypto.randomUUID(),
                userId: target.id,
                title: "hi",
                config: {},
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            }).run();
            db.insert(schema.generationLogs).values({
                id: crypto.randomUUID(),
                userId: target.id,
                modelName: "gpt-4o-mini",
                capability: "chat",
                status: "completed",
                inputSummary: "hi",
                generationKwargs: {},
                isDeleted: false,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            }).run();

            deleteUser("cascade-me", "root");

            expect(db.select().from(schema.sessions).where(eqSessionUser(target.id)).all()).toHaveLength(0);
            expect(db.select().from(schema.conversations).all()).toHaveLength(0);
            expect(db.select().from(schema.generationLogs).all()).toHaveLength(0);
        });
    });

    describe("changeOwnPassword", () => {
        it("rotates the password when the current password is correct", async () => {
            const target = seedUser({ username: "selfie", passwordHash: await hashPassword("password") });
            await changeOwnPassword("selfie", { current_password: "password", new_password: "newpassword456" });
            const row = db.select().from(schema.users).where(eqUsername("selfie")).get()!;
            expect(row.passwordHash).not.toBe(target.passwordHash);
            expect(await verifyPassword("newpassword456", row.passwordHash)).toBe(true);
        });

        it("revokes all sessions after a successful self password change", async () => {
            const target = seedUser({ username: "selfie2", passwordHash: await hashPassword("password") });
            seedSession(target.id);
            await changeOwnPassword("selfie2", { current_password: "password", new_password: "newpassword456" });
            expect(db.select().from(schema.sessions).where(eqSessionUser(target.id)).all()).toHaveLength(0);
        });

        it("rejects an incorrect current password with 401 and does not change anything", async () => {
            const target = seedUser({ username: "selfie3", passwordHash: await hashPassword("password") });
            await expectHttpError(
                () => changeOwnPassword("selfie3", { current_password: "wrong-password", new_password: "newpassword456" }),
                401,
            );
            const row = db.select().from(schema.users).where(eqUsername("selfie3")).get()!;
            expect(row.passwordHash).toBe(target.passwordHash);
        });

        it("throws 404 for a user that doesn't exist", async () => {
            await expectHttpError(
                () => changeOwnPassword("ghost", { current_password: "password", new_password: "newpassword456" }),
                404,
            );
        });
    });
});

// ---- local query helpers ----
function eqUsername(username: string) {
    return eq(schema.users.username, username);
}
function eqSessionUser(userId: string) {
    return eq(schema.sessions.userId, userId);
}
