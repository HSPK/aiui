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
// login/logout ride on lib/server/auth/session.ts's cookie plumbing,
// which calls next/headers' `cookies()` — only valid inside a real
// Next request scope. Fake it with an in-memory jar (same approach as
// tests/node/auth/session.test.ts) so we can invoke the handlers directly.
vi.mock("next/headers", () => ({ cookies: vi.fn() }));

import { cookies } from "next/headers";
import { GET as healthGET } from "@/app/api/health/route";
import { GET as pingGET } from "@/app/api/ping/route";
import { POST as loginPOST } from "@/app/api/login/route";
import { POST as logoutPOST } from "@/app/api/logout/route";
import { db, schema } from "@/lib/server/db";
import { eq } from "drizzle-orm";
import { sha256 } from "@/lib/server/crypto";
import { resetDb, seedUser } from "../../helpers/db";
import { asAnon, envelope, getReq, postJson } from "./_helpers";

interface FakeJar {
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
}

function installJar(initial?: Record<string, string>): FakeJar {
    const store = new Map<string, string>(Object.entries(initial ?? {}));
    const jar: FakeJar = {
        get: vi.fn((name: string) => {
            const value = store.get(name);
            return value === undefined ? undefined : { name, value };
        }),
        set: vi.fn((name: string, value: string) => store.set(name, value)),
        delete: vi.fn((name: string) => store.delete(name)),
    };
    vi.mocked(cookies).mockResolvedValue(jar as never);
    return jar;
}

describe("GET /api/health", () => {
    beforeEach(() => {
        resetDb();
        asAnon();
    });

    it("is public and returns ok without auth", async () => {
        const res = await healthGET(getReq("/api/health"));
        expect(res.status).toBe(200);
        const body = await envelope<{ status: string }>(res);
        expect(body).toEqual({ code: 0, msg: "ok", data: { status: "ok" } });
    });
});

describe("GET /api/ping", () => {
    beforeEach(() => {
        resetDb();
        asAnon();
    });

    it("is public and returns pong", async () => {
        const res = await pingGET(getReq("/api/ping"));
        expect(res.status).toBe(200);
        const body = await envelope<string>(res);
        expect(body).toEqual({ code: 0, msg: "ok", data: "pong" });
    });
});

describe("POST /api/login", () => {
    beforeEach(() => {
        resetDb();
        asAnon();
    });

    it("400s on a missing/invalid body", async () => {
        installJar();
        const res = await loginPOST(postJson("/api/login", { user_name: "" }));
        expect(res.status).toBe(400);
        const body = await envelope(res);
        expect(body.code).not.toBe(0);
    });

    it("401s with a message that does not leak whether the account exists (unknown user)", async () => {
        installJar();
        const res = await loginPOST(postJson("/api/login", { user_name: "nobody", user_password: "whatever" }));
        expect(res.status).toBe(401);
        const body = await envelope(res);
        expect(body.msg).toBe("Invalid username or password");
    });

    it("401s for a known user with a wrong password", async () => {
        seedUser({ username: "carol" });
        installJar();
        const res = await loginPOST(postJson("/api/login", { user_name: "carol", user_password: "wrong" }));
        expect(res.status).toBe(401);
    });

    it("logs in a real user (hashed via the real bcrypt path) and sets the session cookie", async () => {
        const { hashPassword } = await import("@/lib/server/auth");
        const passwordHash = await hashPassword("correct-horse");
        seedUser({ username: "dave", passwordHash });
        const jar = installJar();

        const res = await loginPOST(postJson("/api/login", { user_name: "DAVE", user_password: "correct-horse" }));
        expect(res.status).toBe(200);
        const body = await envelope<{ username: string; role: string }>(res);
        expect(body.data.username).toBe("dave");

        expect(jar.set).toHaveBeenCalledWith(
            "loom_session",
            expect.any(String),
            expect.objectContaining({ httpOnly: true }),
        );
        const token = jar.set.mock.calls[0][1] as string;
        const row = db.select().from(schema.sessions).where(eq(schema.sessions.id, sha256(token))).get();
        expect(row).toBeDefined();
    });

    it("normalizes the username before lookup (case-insensitive)", async () => {
        const { hashPassword } = await import("@/lib/server/auth");
        const passwordHash = await hashPassword("secretpw");
        seedUser({ username: "erin", passwordHash });
        installJar();
        const res = await loginPOST(postJson("/api/login", { user_name: "  Erin  ", user_password: "secretpw" }));
        expect(res.status).toBe(200);
    });

    it("429s after enough failed attempts to trip the per-(username,ip) lockout", async () => {
        installJar();
        // No LOOM_TRUST_PROXY -> callerIp() always resolves "unknown"
        // -> the LENIENT login-untrusted policy applies: 30 failures
        // inside a 60s window trip a 60s lockout. Use a username
        // unique to this test so it doesn't share a bucket with any
        // other test in this file.
        const username = "lockout-victim";
        for (let i = 0; i < 30; i++) {
            const attempt = await loginPOST(postJson("/api/login", { user_name: username, user_password: "wrong" }));
            expect(attempt.status).toBe(401);
        }
        const locked = await loginPOST(postJson("/api/login", { user_name: username, user_password: "wrong" }));
        expect(locked.status).toBe(429);
        const body = await envelope(locked);
        expect(body.msg).toMatch(/too many failed attempts/i);
        // Slowest test in the suite (~2.7s) and deliberately so: 31 requests
        // against a username that doesn't exist, each paying a full bcrypt
        // compare against DUMMY_HASH because the login route refuses to let
        // response timing reveal whether a username exists. See the raised
        // testTimeout in vitest.config.mts.
    });
});

describe("POST /api/logout", () => {
    beforeEach(() => {
        resetDb();
        asAnon();
    });

    it("is public, always 200s, and clears the session cookie", async () => {
        const jar = installJar();
        const res = await logoutPOST(postJson("/api/logout", {}));
        expect(res.status).toBe(200);
        expect(jar.delete).toHaveBeenCalledWith("loom_session");
    });

    it("destroys a real session row when a cookie is present", async () => {
        const user = seedUser({ username: "frank" });
        const { createSession } = await import("@/lib/server/auth");
        const token = await createSession(user.id);
        installJar({ loom_session: token });
        const before = db.select().from(schema.sessions).all();
        expect(before).toHaveLength(1);

        const res = await logoutPOST(postJson("/api/logout", {}));
        expect(res.status).toBe(200);
        const after = db.select().from(schema.sessions).all();
        expect(after).toHaveLength(0);
    });

    it("no-ops cleanly when there is no session cookie at all", async () => {
        installJar();
        const res = await logoutPOST(postJson("/api/logout", {}));
        expect(res.status).toBe(200);
    });
});
