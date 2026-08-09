// lib/server/auth/bearer.ts — API-key parsing/lookup/expiry, and its
// interaction with the STRICT bearer rate-limit policy.
//
// Rate-limit state lives in `globalThis.__loom_credential_buckets__`,
// shared for the lifetime of this test file's module registry. To avoid
// cross-test interference we give every test its own unique token/ip
// (bucketKey is derived from the token's hash, so distinct tokens land in
// distinct buckets) rather than resetting global state between tests.
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/server/db";
import { API_KEY_PREFIX, authenticateBearer, generateApiKey } from "@/lib/server/auth/bearer";
import { resetDb, seedUser } from "@/tests/helpers/db";

const ORIGINAL_TRUST_PROXY = process.env.LOOM_TRUST_PROXY;

function req(headers: Record<string, string> = {}): Request {
    return new Request("http://localhost/api/v1/models", { headers });
}

function bearerReq(token: string): Request {
    return req({ Authorization: `Bearer ${token}` });
}

/** Inserts a real, queryable api_keys row for `userId` and returns both
 *  the plaintext key (to authenticate with) and the row id. */
function insertApiKey(
    userId: string,
    overrides: Partial<{ expiresAt: string | null; lastUsedAt: string | null }> = {},
): { id: string; plain: string } {
    const { plain, prefix, hash } = generateApiKey();
    const id = randomUUID();
    db.insert(schema.apiKeys)
        .values({
            id,
            userId,
            name: "test-key",
            prefix,
            keyHash: hash,
            lastUsedAt: overrides.lastUsedAt ?? null,
            expiresAt: overrides.expiresAt ?? null,
        })
        .run();
    return { id, plain };
}

describe("auth/bearer", () => {
    beforeEach(() => {
        resetDb();
        if (ORIGINAL_TRUST_PROXY === undefined) delete process.env.LOOM_TRUST_PROXY;
        else process.env.LOOM_TRUST_PROXY = ORIGINAL_TRUST_PROXY;
    });

    afterEach(() => {
        if (ORIGINAL_TRUST_PROXY === undefined) delete process.env.LOOM_TRUST_PROXY;
        else process.env.LOOM_TRUST_PROXY = ORIGINAL_TRUST_PROXY;
    });

    describe("generateApiKey", () => {
        it("produces a plaintext key with the sk-loom- prefix, a 12-char display prefix, and a sha256 hash", () => {
            const { plain, prefix, hash } = generateApiKey();
            expect(plain.startsWith(API_KEY_PREFIX)).toBe(true);
            expect(prefix).toBe(plain.slice(0, 12));
            expect(hash).toMatch(/^[0-9a-f]{64}$/);
        });

        it("generates a unique plaintext key each call", () => {
            expect(generateApiKey().plain).not.toBe(generateApiKey().plain);
        });
    });

    describe("authenticateBearer — happy path", () => {
        it("resolves the SessionUser for a valid key with no expiry", async () => {
            const user = seedUser({ username: "keyholder" });
            const { plain } = insertApiKey(user.id);
            const result = await authenticateBearer(bearerReq(plain));
            expect(result).toEqual({
                id: user.id,
                username: "keyholder",
                role: "user",
                createdAt: user.createdAt,
            });
        });

        it("resolves for a key whose expiresAt is in the future", async () => {
            const user = seedUser();
            const future = new Date(Date.now() + 60_000).toISOString();
            const { plain } = insertApiKey(user.id, { expiresAt: future });
            await expect(authenticateBearer(bearerReq(plain))).resolves.toMatchObject({ id: user.id });
        });
    });

    describe("authenticateBearer — missing/malformed credentials", () => {
        it("throws 401 'Missing ******' when there's no Authorization header at all", async () => {
            await expect(authenticateBearer(req())).rejects.toMatchObject({
                status: 401,
                message: "Missing Bearer token",
            });
        });

        it("throws 401 'Missing ******' for a non-Bearer scheme", async () => {
            await expect(authenticateBearer(req({ Authorization: "Basic dXNlcjpwYXNz" }))).rejects.toMatchObject({
                status: 401,
                message: "Missing Bearer token",
            });
        });

        it("throws 401 'Missing ******' for 'Bearer' with no token following it", async () => {
            await expect(authenticateBearer(req({ Authorization: "Bearer " }))).rejects.toMatchObject({
                status: 401,
                message: "Missing Bearer token",
            });
        });

        it("never rate-limits missing-token requests, no matter how many times repeated", async () => {
            for (let i = 0; i < 20; i++) {
                await expect(authenticateBearer(req())).rejects.toMatchObject({ status: 401 });
            }
            // Still a plain 401, never escalates to 429.
            await expect(authenticateBearer(req())).rejects.toMatchObject({ status: 401 });
        });
    });

    describe("authenticateBearer — invalid key", () => {
        it("throws 401 'Invalid API key' for a well-formed but unknown key", async () => {
            const token = `${API_KEY_PREFIX}${randomUUID()}`;
            await expect(authenticateBearer(bearerReq(token))).rejects.toMatchObject({
                status: 401,
                message: "Invalid API key",
            });
        });
    });

    describe("authenticateBearer — expiry handling", () => {
        it("throws 401 'API key has expired' for an expired (ISO/Z) expiresAt, without locking out the caller", async () => {
            const user = seedUser();
            const past = new Date(Date.now() - 60_000).toISOString(); // always ends with Z
            const { plain } = insertApiKey(user.id, { expiresAt: past });

            for (let i = 0; i < 8; i++) {
                await expect(authenticateBearer(bearerReq(plain))).rejects.toMatchObject({
                    status: 401,
                    message: "API key has expired",
                });
            }
        });

        it("treats a naive (no Z, no offset) past timestamp as UTC and expired", async () => {
            const user = seedUser();
            const naive = "2020-01-01T00:00:00"; // no trailing Z, no offset
            const { plain } = insertApiKey(user.id, { expiresAt: naive });
            await expect(authenticateBearer(bearerReq(plain))).rejects.toMatchObject({
                status: 401,
                message: "API key has expired",
            });
        });

        it("accepts an explicit-offset past timestamp and still treats it as expired", async () => {
            const user = seedUser();
            const withOffset = "2020-01-01T00:00:00+05:00";
            const { plain } = insertApiKey(user.id, { expiresAt: withOffset });
            await expect(authenticateBearer(bearerReq(plain))).rejects.toMatchObject({
                status: 401,
                message: "API key has expired",
            });
        });

        it("throws 401 'API key has invalid expiration' for an unparseable expiresAt, and logs a warning", async () => {
            const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
            const user = seedUser();
            const { plain } = insertApiKey(user.id, { expiresAt: "not-a-real-date" });
            await expect(authenticateBearer(bearerReq(plain))).rejects.toMatchObject({
                status: 401,
                message: "API key has invalid expiration",
            });
            expect(warnSpy).toHaveBeenCalled();
            warnSpy.mockRestore();
        });
    });

    describe("authenticateBearer — lastUsedAt debounce", () => {
        it("sets lastUsedAt on first use (was null)", async () => {
            const user = seedUser();
            const { id, plain } = insertApiKey(user.id, { lastUsedAt: null });
            await authenticateBearer(bearerReq(plain));
            const row = db.select().from(schema.apiKeys).where(eq(schema.apiKeys.id, id)).get();
            expect(row!.lastUsedAt).not.toBeNull();
        });

        it("does not rewrite lastUsedAt when it was updated less than 60s ago", async () => {
            const user = seedUser();
            const recent = new Date(Date.now() - 1000).toISOString();
            const { id, plain } = insertApiKey(user.id, { lastUsedAt: recent });
            await authenticateBearer(bearerReq(plain));
            const row = db.select().from(schema.apiKeys).where(eq(schema.apiKeys.id, id)).get();
            expect(row!.lastUsedAt).toBe(recent);
        });

        it("does not rewrite lastUsedAt when the existing value is recent but naive (no Z/offset)", async () => {
            const user = seedUser();
            const recentNaive = new Date(Date.now() - 1000).toISOString().replace("Z", "");
            const { id, plain } = insertApiKey(user.id, { lastUsedAt: recentNaive });
            await authenticateBearer(bearerReq(plain));
            const row = db.select().from(schema.apiKeys).where(eq(schema.apiKeys.id, id)).get();
            expect(row!.lastUsedAt).toBe(recentNaive);
        });

        it("rewrites lastUsedAt when the existing value is more than 60s stale", async () => {
            const user = seedUser();
            const stale = new Date(Date.now() - 120_000).toISOString();
            const { id, plain } = insertApiKey(user.id, { lastUsedAt: stale });
            await authenticateBearer(bearerReq(plain));
            const row = db.select().from(schema.apiKeys).where(eq(schema.apiKeys.id, id)).get();
            expect(row!.lastUsedAt).not.toBe(stale);
            expect(new Date(row!.lastUsedAt!).getTime()).toBeGreaterThan(new Date(stale).getTime());
        });
    });

    describe("authenticateBearer — STRICT lockout policy (per token-prefix bucket when IP is untrusted)", () => {
        it("locks out after 5 failed attempts against the same unknown token, returning 429 with Retry-After", async () => {
            const token = `${API_KEY_PREFIX}${randomUUID()}-lockout-1`;
            for (let i = 0; i < 5; i++) {
                await expect(authenticateBearer(bearerReq(token))).rejects.toMatchObject({ status: 401 });
            }
            await expect(authenticateBearer(bearerReq(token))).rejects.toMatchObject({
                status: 429,
                headers: { "Retry-After": expect.any(String) },
            });
        });

        it("recovers after the lockout window passes", async () => {
            vi.useFakeTimers();
            try {
                const token = `${API_KEY_PREFIX}${randomUUID()}-lockout-2`;
                for (let i = 0; i < 5; i++) {
                    await expect(authenticateBearer(bearerReq(token))).rejects.toMatchObject({ status: 401 });
                }
                await expect(authenticateBearer(bearerReq(token))).rejects.toMatchObject({ status: 429 });

                await vi.advanceTimersByTimeAsync(15 * 60 * 1000 + 1000);

                // Lockout has lifted — back to a plain 401 for the still-invalid key.
                await expect(authenticateBearer(bearerReq(token))).rejects.toMatchObject({ status: 401 });
            } finally {
                vi.useRealTimers();
            }
        });

        it("a distinct token gets its own bucket and is unaffected by another token's lockout", async () => {
            const lockedToken = `${API_KEY_PREFIX}${randomUUID()}-victim`;
            for (let i = 0; i < 6; i++) {
                await authenticateBearer(bearerReq(lockedToken)).catch(() => {});
            }
            await expect(authenticateBearer(bearerReq(lockedToken))).rejects.toMatchObject({ status: 429 });

            const otherToken = `${API_KEY_PREFIX}${randomUUID()}-bystander`;
            await expect(authenticateBearer(bearerReq(otherToken))).rejects.toMatchObject({ status: 401 });
        });

        it("under LOOM_TRUST_PROXY=1, distinct tokens from the SAME IP share one per-IP bucket", async () => {
            process.env.LOOM_TRUST_PROXY = "1";
            const ip = `203.0.113.${Math.floor(Math.random() * 250) + 1}`;
            const headersFor = (token: string) => ({
                Authorization: `Bearer ${token}`,
                "X-Forwarded-For": ip,
            });

            for (let i = 0; i < 5; i++) {
                await expect(
                    authenticateBearer(req(headersFor(`${API_KEY_PREFIX}${randomUUID()}`))),
                ).rejects.toMatchObject({ status: 401 });
            }
            // A brand-new, never-before-seen token from the SAME ip is
            // already locked out — proving the bucket is per-IP, not per-token.
            await expect(
                authenticateBearer(req(headersFor(`${API_KEY_PREFIX}${randomUUID()}`))),
            ).rejects.toMatchObject({ status: 429 });
        });

        it("a successful auth does not need to reset anything — the STRICT bearer policy has no success wrapper call", async () => {
            // authenticateBearer never calls recordSuccess for bearer; a
            // valid key simply doesn't add failures. Sanity-check that a
            // valid key succeeds even after a handful of unrelated failures
            // on OTHER tokens (isolated buckets).
            const user = seedUser();
            const { plain } = insertApiKey(user.id);
            for (let i = 0; i < 3; i++) {
                await authenticateBearer(bearerReq(`${API_KEY_PREFIX}${randomUUID()}`)).catch(() => {});
            }
            await expect(authenticateBearer(bearerReq(plain))).resolves.toMatchObject({ id: user.id });
        });
    });
});
