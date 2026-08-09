// lib/server/auth/session.ts — cookie session lifecycle: create/read/
// destroy, TTL/expiry handling, and the requireUser/requireAdmin guards.
//
// Next's `cookies()` (from "next/headers") only works inside a request
// scope, so it's mocked wholesale. Each test installs a small in-memory
// fake "jar" that mimics the subset of the cookie-store API session.ts
// actually uses: get(name), set(name, value, opts), delete(name).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/server/db";
import { sha256 } from "@/lib/server/crypto";
import {
    clearSessionCookie,
    createSession,
    destroySession,
    getCurrentUser,
    requireAdmin,
    requireUser,
    SESSION_COOKIE,
    setSessionCookie,
} from "@/lib/server/auth/session";
import { resetDb, seedUser } from "@/tests/helpers/db";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));

interface FakeJar {
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    _store: Map<string, string>;
}

function createFakeJar(initial?: Record<string, string>): FakeJar {
    const store = new Map<string, string>(Object.entries(initial ?? {}));
    return {
        _store: store,
        get: vi.fn((name: string) => {
            const value = store.get(name);
            return value === undefined ? undefined : { name, value };
        }),
        set: vi.fn((name: string, value: string) => {
            store.set(name, value);
        }),
        delete: vi.fn((name: string) => {
            store.delete(name);
        }),
    };
}

function installJar(initial?: Record<string, string>): FakeJar {
    const jar = createFakeJar(initial);
    vi.mocked(cookies).mockResolvedValue(jar as never);
    return jar;
}

const ORIGINAL_TTL = process.env.LOOM_SESSION_TTL_DAYS;

describe("auth/session", () => {
    beforeEach(() => {
        resetDb();
        vi.mocked(cookies).mockReset();
        if (ORIGINAL_TTL === undefined) delete process.env.LOOM_SESSION_TTL_DAYS;
        else process.env.LOOM_SESSION_TTL_DAYS = ORIGINAL_TTL;
        // NODE_ENV is typed read-only by @types/node; vi.stubEnv/unstubAllEnvs
        // is the supported way to mutate it from a test.
        vi.unstubAllEnvs();
    });

    describe("createSession", () => {
        it("returns an opaque token and persists a session row keyed by sha256(token)", async () => {
            const user = seedUser();
            const token = await createSession(user.id);
            expect(typeof token).toBe("string");
            expect(token.length).toBeGreaterThan(20);

            const row = db.select().from(schema.sessions).where(eq(schema.sessions.id, sha256(token))).get();
            expect(row).toBeDefined();
            expect(row!.userId).toBe(user.id);
        });

        it("defaults expiry to 30 days when LOOM_SESSION_TTL_DAYS is unset", async () => {
            delete process.env.LOOM_SESSION_TTL_DAYS;
            const user = seedUser();
            const before = Date.now();
            const token = await createSession(user.id);
            const row = db.select().from(schema.sessions).where(eq(schema.sessions.id, sha256(token))).get();
            const expectedMs = 30 * 86400 * 1000;
            const delta = row!.expiresAt.getTime() - before;
            expect(delta).toBeGreaterThan(expectedMs - 5000);
            expect(delta).toBeLessThan(expectedMs + 5000);
        });

        it("honors a custom LOOM_SESSION_TTL_DAYS", async () => {
            process.env.LOOM_SESSION_TTL_DAYS = "1";
            const user = seedUser();
            const before = Date.now();
            const token = await createSession(user.id);
            const row = db.select().from(schema.sessions).where(eq(schema.sessions.id, sha256(token))).get();
            const expectedMs = 1 * 86400 * 1000;
            const delta = row!.expiresAt.getTime() - before;
            expect(delta).toBeGreaterThan(expectedMs - 5000);
            expect(delta).toBeLessThan(expectedMs + 5000);
        });

        it.each(["abc", "-5", "0"])(
            "falls back to the 30-day default for an invalid LOOM_SESSION_TTL_DAYS=%s",
            async (invalid) => {
                process.env.LOOM_SESSION_TTL_DAYS = invalid;
                const user = seedUser();
                const before = Date.now();
                const token = await createSession(user.id);
                const row = db.select().from(schema.sessions).where(eq(schema.sessions.id, sha256(token))).get();
                const expectedMs = 30 * 86400 * 1000;
                const delta = row!.expiresAt.getTime() - before;
                expect(delta).toBeGreaterThan(expectedMs - 5000);
                expect(delta).toBeLessThan(expectedMs + 5000);
            },
        );

        it("opportunistically purges already-expired sessions before inserting the new one", async () => {
            const user = seedUser();
            db.insert(schema.sessions)
                .values({ id: "expired-session-id", userId: user.id, expiresAt: new Date(Date.now() - 1000) })
                .run();

            await createSession(user.id);

            const stillThere = db
                .select()
                .from(schema.sessions)
                .where(eq(schema.sessions.id, "expired-session-id"))
                .get();
            expect(stillThere).toBeUndefined();
        });
    });

    describe("setSessionCookie / clearSessionCookie", () => {
        it("sets an httpOnly, lax, path=/ cookie with the token and a maxAge matching the TTL", async () => {
            vi.stubEnv("NODE_ENV", "test");
            process.env.LOOM_SESSION_TTL_DAYS = "2";
            const jar = installJar();
            await setSessionCookie("the-token-value");
            expect(jar.set).toHaveBeenCalledWith(
                SESSION_COOKIE,
                "the-token-value",
                expect.objectContaining({
                    httpOnly: true,
                    sameSite: "lax",
                    secure: false,
                    path: "/",
                    maxAge: 2 * 86400,
                }),
            );
        });

        it("sets secure:true when NODE_ENV is production", async () => {
            vi.stubEnv("NODE_ENV", "production");
            const jar = installJar();
            await setSessionCookie("tok");
            expect(jar.set).toHaveBeenCalledWith(SESSION_COOKIE, "tok", expect.objectContaining({ secure: true }));
        });

        it("clearSessionCookie deletes the session cookie", async () => {
            const jar = installJar();
            await clearSessionCookie();
            expect(jar.delete).toHaveBeenCalledWith(SESSION_COOKIE);
        });
    });

    describe("destroySession", () => {
        it("is a no-op for a null/undefined token", async () => {
            const user = seedUser();
            const token = await createSession(user.id);
            await destroySession(null);
            await destroySession(undefined);
            const row = db.select().from(schema.sessions).where(eq(schema.sessions.id, sha256(token))).get();
            expect(row).toBeDefined();
        });

        it("removes the matching session row", async () => {
            const user = seedUser();
            const token = await createSession(user.id);
            await destroySession(token);
            const row = db.select().from(schema.sessions).where(eq(schema.sessions.id, sha256(token))).get();
            expect(row).toBeUndefined();
        });
    });

    describe("getCurrentUser", () => {
        it("returns null when there is no session cookie", async () => {
            installJar();
            await expect(getCurrentUser()).resolves.toBeNull();
        });

        it("returns null when the cookie doesn't match any session row", async () => {
            installJar({ [SESSION_COOKIE]: "not-a-real-token" });
            await expect(getCurrentUser()).resolves.toBeNull();
        });

        it("returns the session user for a valid, unexpired session", async () => {
            const user = seedUser({ username: "carol" });
            const token = await createSession(user.id);
            installJar({ [SESSION_COOKIE]: token });

            const current = await getCurrentUser();
            expect(current).toEqual({
                id: user.id,
                username: "carol",
                role: "user",
                createdAt: user.createdAt,
            });
        });

        it("returns null and purges the row when the session has expired", async () => {
            const user = seedUser();
            const token = "expired-token-value";
            db.insert(schema.sessions)
                .values({ id: sha256(token), userId: user.id, expiresAt: new Date(Date.now() - 1000) })
                .run();
            installJar({ [SESSION_COOKIE]: token });

            await expect(getCurrentUser()).resolves.toBeNull();
            const row = db.select().from(schema.sessions).where(eq(schema.sessions.id, sha256(token))).get();
            expect(row).toBeUndefined();
        });
    });

    describe("requireUser", () => {
        it("throws an HttpError(401) when there is no current user", async () => {
            installJar();
            await expect(requireUser()).rejects.toMatchObject({ status: 401 });
        });

        it("returns the current user when present", async () => {
            const user = seedUser();
            const token = await createSession(user.id);
            installJar({ [SESSION_COOKIE]: token });
            await expect(requireUser()).resolves.toMatchObject({ id: user.id });
        });
    });

    describe("requireAdmin", () => {
        it("propagates the 401 from requireUser when unauthenticated", async () => {
            installJar();
            await expect(requireAdmin()).rejects.toMatchObject({ status: 401 });
        });

        it("throws an HttpError(403) for a non-admin user", async () => {
            const user = seedUser({ role: "user" });
            const token = await createSession(user.id);
            installJar({ [SESSION_COOKIE]: token });
            await expect(requireAdmin()).rejects.toMatchObject({ status: 403, message: "Admin required" });
        });

        it("returns the user when they are an admin", async () => {
            const admin = seedUser({ role: "admin" });
            const token = await createSession(admin.id);
            installJar({ [SESSION_COOKIE]: token });
            await expect(requireAdmin()).resolves.toMatchObject({ id: admin.id, role: "admin" });
        });
    });
});
