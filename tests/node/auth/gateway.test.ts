// lib/server/auth/gateway.ts — authenticateGateway: Bearer-token OR
// session-cookie authentication for /api/v1/* and playground routes.
//
// Exercises the REAL authenticateBearer + getCurrentUser implementations
// (seeded DB rows for the bearer path, a mocked next/headers cookie jar
// for the session path) rather than mocking them, so the actual
// branching inside authenticateGateway is what's under test.
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cookies } from "next/headers";
import { db, schema } from "@/lib/server/db";
import { authenticateGateway } from "@/lib/server/auth/gateway";
import { generateApiKey } from "@/lib/server/auth/bearer";
import { createSession, SESSION_COOKIE } from "@/lib/server/auth/session";
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

function insertApiKey(userId: string) {
    const { plain, prefix, hash } = generateApiKey();
    db.insert(schema.apiKeys)
        .values({ id: randomUUID(), userId, name: "gw-key", prefix, keyHash: hash })
        .run();
    return plain;
}

function req(headers: Record<string, string> = {}): Request {
    return new Request("http://localhost/api/v1/chat/completions", { headers });
}

describe("auth/gateway: authenticateGateway", () => {
    beforeEach(() => {
        resetDb();
        vi.mocked(cookies).mockReset();
    });

    it("authenticates via a valid Bearer API key", async () => {
        const user = seedUser({ username: "gw-bearer-user" });
        const plain = insertApiKey(user.id);
        const result = await authenticateGateway(req({ Authorization: `Bearer ${plain}` }));
        expect(result).toMatchObject({ id: user.id, username: "gw-bearer-user" });
    });

    it("propagates the 401 from authenticateBearer for an invalid Bearer token", async () => {
        installJar(); // shouldn't even be consulted, but keep cookies() well-defined
        await expect(
            authenticateGateway(req({ Authorization: `Bearer ${randomUUID()}` })),
        ).rejects.toMatchObject({ status: 401 });
    });

    it("falls back to the session cookie when there's no Authorization header", async () => {
        const user = seedUser({ username: "gw-cookie-user" });
        const token = await createSession(user.id);
        installJar({ [SESSION_COOKIE]: token });

        const result = await authenticateGateway(req());
        expect(result).toMatchObject({ id: user.id, username: "gw-cookie-user" });
    });

    it("falls back to the session cookie when the Authorization header isn't a Bearer scheme", async () => {
        const user = seedUser({ username: "gw-basic-user" });
        const token = await createSession(user.id);
        installJar({ [SESSION_COOKIE]: token });

        const result = await authenticateGateway(req({ Authorization: "Basic abc123" }));
        expect(result).toMatchObject({ id: user.id, username: "gw-basic-user" });
    });

    it("matches the Bearer scheme case-insensitively", async () => {
        const user = seedUser();
        const plain = insertApiKey(user.id);
        const result = await authenticateGateway(req({ Authorization: `bearer ${plain}` }));
        expect(result).toMatchObject({ id: user.id });
    });

    it("throws 401 'Missing or invalid credentials' when there's no header and no session cookie", async () => {
        installJar();
        await expect(authenticateGateway(req())).rejects.toMatchObject({
            status: 401,
            message: "Missing or invalid credentials",
        });
    });

    it("throws 401 when the Authorization header is non-Bearer AND there's no session cookie", async () => {
        installJar();
        await expect(authenticateGateway(req({ Authorization: "Basic xyz" }))).rejects.toMatchObject({
            status: 401,
            message: "Missing or invalid credentials",
        });
    });
});
