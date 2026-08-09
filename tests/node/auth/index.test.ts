// lib/server/auth/index.ts + lib/server/auth/types.ts — the public auth
// barrel (re-exports from session/bearer/gateway/password) and the
// User -> SessionUser projection.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cookies } from "next/headers";
import {
    API_KEY_PREFIX,
    authenticateBearer,
    authenticateGateway,
    clearSessionCookie,
    createSession,
    destroySession,
    generateApiKey,
    getCurrentUser,
    hashPassword,
    requireAdmin,
    requireUser,
    SESSION_COOKIE,
    setSessionCookie,
    verifyPassword,
} from "@/lib/server/auth";
import { userToSession } from "@/lib/server/auth/types";
import { resetDb, seedUser } from "@/tests/helpers/db";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));

function createFakeJar(initial?: Record<string, string>) {
    const store = new Map<string, string>(Object.entries(initial ?? {}));
    return {
        get: vi.fn((name: string) => {
            const value = store.get(name);
            return value === undefined ? undefined : { name, value };
        }),
        set: vi.fn(),
        delete: vi.fn(),
    };
}

function installJar(initial?: Record<string, string>) {
    const jar = createFakeJar(initial);
    vi.mocked(cookies).mockResolvedValue(jar as never);
    return jar;
}

describe("auth/types: userToSession", () => {
    it("projects id/username/role/createdAt and drops the password hash", () => {
        const user = seedUser({
            id: "u1",
            username: "dana",
            role: "admin",
            passwordHash: "$2b$10$super-secret-hash",
            createdAt: "2024-01-01T00:00:00.000Z",
        });
        const session = userToSession(user);
        expect(session).toEqual({
            id: "u1",
            username: "dana",
            role: "admin",
            createdAt: "2024-01-01T00:00:00.000Z",
        });
        expect(session).not.toHaveProperty("passwordHash");
    });
});

describe("auth/index: barrel re-exports", () => {
    beforeEach(() => {
        resetDb();
        vi.mocked(cookies).mockReset();
    });

    it("re-exports the constants and every function as the correct type", () => {
        expect(SESSION_COOKIE).toBe("loom_session");
        expect(API_KEY_PREFIX).toBe("sk-loom-");
        for (const fn of [
            createSession,
            setSessionCookie,
            clearSessionCookie,
            destroySession,
            getCurrentUser,
            requireUser,
            requireAdmin,
            generateApiKey,
            authenticateBearer,
            authenticateGateway,
            hashPassword,
            verifyPassword,
        ]) {
            expect(typeof fn).toBe("function");
        }
    });

    it("end-to-end through the barrel: requireAdmin resolves for an admin session, and 403s for a non-admin", async () => {
        const admin = seedUser({ role: "admin" });
        const adminToken = await createSession(admin.id);
        installJar({ [SESSION_COOKIE]: adminToken });
        await expect(requireAdmin()).resolves.toMatchObject({ id: admin.id, role: "admin" });

        const plain = seedUser({ role: "user" });
        const plainToken = await createSession(plain.id);
        installJar({ [SESSION_COOKIE]: plainToken });
        await expect(requireAdmin()).rejects.toMatchObject({ status: 403, message: "Admin required" });
    });

    it("end-to-end through the barrel: getCurrentUser / requireUser reflect the mocked cookie jar", async () => {
        installJar();
        await expect(getCurrentUser()).resolves.toBeNull();
        await expect(requireUser()).rejects.toMatchObject({ status: 401 });

        const user = seedUser();
        const token = await createSession(user.id);
        installJar({ [SESSION_COOKIE]: token });
        await expect(getCurrentUser()).resolves.toMatchObject({ id: user.id });
        await expect(requireUser()).resolves.toMatchObject({ id: user.id });
    });
});
