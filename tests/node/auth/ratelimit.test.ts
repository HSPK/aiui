// lib/server/auth/ratelimit.ts — in-memory failed-credential rate limiter.
//
// Two policy shapes matter here:
//   - STRICT (login when IP is trusted, and bearer always): 5 attempts /
//     15 min window / 15 min lockout.
//   - LENIENT ("login-untrusted", used when the caller IP can't be
//     trusted): 30 attempts / 60s window / 60s lockout.
//
// State lives in `globalThis.__loom_credential_buckets__` for the life of
// the process/module registry. Tests use unique keys per scenario so they
// don't need to reset that global between assertions; the couple of tests
// that DO need a pristine module (the sweep test) explicitly clear the
// global and re-import under fake timers.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    callerIp,
    checkBearerLockout,
    checkLockout,
    checkLoginLockout,
    recordFailedBearer,
    recordFailedLogin,
    recordFailure,
    recordSuccess,
    recordSuccessfulLogin,
} from "@/lib/server/auth/ratelimit";

const ORIGINAL_TRUST_PROXY = process.env.LOOM_TRUST_PROXY;

function resetTrustProxy() {
    if (ORIGINAL_TRUST_PROXY === undefined) delete process.env.LOOM_TRUST_PROXY;
    else process.env.LOOM_TRUST_PROXY = ORIGINAL_TRUST_PROXY;
}

function makeReq(headers: Record<string, string> = {}): Request {
    return new Request("http://localhost/api/login", { headers });
}

describe("auth/ratelimit: callerIp", () => {
    beforeEach(resetTrustProxy);
    afterEach(resetTrustProxy);

    it("returns 'unknown' when LOOM_TRUST_PROXY is unset, even with spoofable headers present", () => {
        delete process.env.LOOM_TRUST_PROXY;
        const r = makeReq({ "x-forwarded-for": "1.2.3.4", "x-real-ip": "5.6.7.8" });
        expect(callerIp(r)).toBe("unknown");
    });

    it("returns 'unknown' when LOOM_TRUST_PROXY is set to something other than '1'", () => {
        process.env.LOOM_TRUST_PROXY = "true";
        const r = makeReq({ "x-forwarded-for": "1.2.3.4" });
        expect(callerIp(r)).toBe("unknown");
    });

    it("trusts the first X-Forwarded-For entry when LOOM_TRUST_PROXY=1", () => {
        process.env.LOOM_TRUST_PROXY = "1";
        const r = makeReq({ "x-forwarded-for": "9.9.9.9, 8.8.8.8, 7.7.7.7" });
        expect(callerIp(r)).toBe("9.9.9.9");
    });

    it("trims whitespace around the first X-Forwarded-For entry", () => {
        process.env.LOOM_TRUST_PROXY = "1";
        const r = makeReq({ "x-forwarded-for": "  9.9.9.9  , 8.8.8.8" });
        expect(callerIp(r)).toBe("9.9.9.9");
    });

    it("falls back to X-Real-IP when X-Forwarded-For is absent (trust_proxy=1)", () => {
        process.env.LOOM_TRUST_PROXY = "1";
        const r = makeReq({ "x-real-ip": "4.4.4.4" });
        expect(callerIp(r)).toBe("4.4.4.4");
    });

    it("falls back to X-Real-IP when X-Forwarded-For's first entry is empty", () => {
        process.env.LOOM_TRUST_PROXY = "1";
        const r = makeReq({ "x-forwarded-for": ",8.8.8.8", "x-real-ip": "4.4.4.4" });
        expect(callerIp(r)).toBe("4.4.4.4");
    });

    it("returns 'unknown' when trust_proxy=1 but neither header is present", () => {
        process.env.LOOM_TRUST_PROXY = "1";
        expect(callerIp(makeReq())).toBe("unknown");
    });
});

describe("auth/ratelimit: generic checkLockout / recordFailure / recordSuccess", () => {
    it("checkLockout returns null for a never-seen key", () => {
        expect(checkLockout("bearer", `never-seen-${crypto.randomUUID()}`)).toBeNull();
    });

    it("recordFailure accumulates attempts within the window but doesn't lock below maxAttempts", () => {
        const key = `below-threshold-${crypto.randomUUID()}`;
        for (let i = 0; i < 4; i++) recordFailure("bearer", key); // STRICT maxAttempts = 5
        expect(checkLockout("bearer", key)).toBeNull();
    });

    it("recordFailure locks the key once maxAttempts is reached", () => {
        const key = `at-threshold-${crypto.randomUUID()}`;
        for (let i = 0; i < 5; i++) recordFailure("bearer", key);
        expect(checkLockout("bearer", key)).not.toBeNull();
    });

    it("recordSuccess clears an existing bucket, un-locking it", () => {
        const key = `cleared-${crypto.randomUUID()}`;
        for (let i = 0; i < 5; i++) recordFailure("bearer", key);
        expect(checkLockout("bearer", key)).not.toBeNull();
        recordSuccess("bearer", key);
        expect(checkLockout("bearer", key)).toBeNull();
    });

    it("recordSuccess on a key that was never recorded is a harmless no-op", () => {
        const key = `never-recorded-${crypto.randomUUID()}`;
        expect(() => recordSuccess("bearer", key)).not.toThrow();
        expect(checkLockout("bearer", key)).toBeNull();
    });

    it("window rollover: old attempts outside windowMs don't count toward the threshold", () => {
        vi.useFakeTimers();
        try {
            const key = `rollover-${crypto.randomUUID()}`;
            for (let i = 0; i < 4; i++) recordFailure("bearer", key); // 4 < 5, not locked
            expect(checkLockout("bearer", key)).toBeNull();

            // STRICT windowMs = 15 minutes — advance past it so those 4
            // attempts age out of the sliding window.
            vi.advanceTimersByTime(16 * 60 * 1000);

            recordFailure("bearer", key); // only 1 attempt inside the *current* window
            expect(checkLockout("bearer", key)).toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });

    it("lockout expires after lockoutMs and checkLockout returns null again", () => {
        vi.useFakeTimers();
        try {
            const key = `expiring-lock-${crypto.randomUUID()}`;
            for (let i = 0; i < 5; i++) recordFailure("bearer", key);
            expect(checkLockout("bearer", key)).not.toBeNull();

            vi.advanceTimersByTime(15 * 60 * 1000 + 1);
            expect(checkLockout("bearer", key)).toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });
});

describe("auth/ratelimit: bearer wrappers", () => {
    it("checkBearerLockout / recordFailedBearer round-trip through the STRICT policy", () => {
        const key = `bearer-wrapper-${crypto.randomUUID()}`;
        expect(checkBearerLockout(key)).toBeNull();
        for (let i = 0; i < 5; i++) recordFailedBearer(key);
        expect(checkBearerLockout(key)).not.toBeNull();
    });
});

describe("auth/ratelimit: login wrappers (STRICT vs LENIENT policy selection)", () => {
    it("uses the STRICT policy (5 attempts) for a trusted (non-'unknown') ip", () => {
        const username = `user-strict-${crypto.randomUUID()}`;
        const ip = "10.0.0.5";
        for (let i = 0; i < 4; i++) recordFailedLogin(username, ip);
        expect(checkLoginLockout(username, ip)).toBeNull();
        recordFailedLogin(username, ip); // 5th attempt
        expect(checkLoginLockout(username, ip)).not.toBeNull();
    });

    it("uses the LENIENT policy (30 attempts) for ip === 'unknown'", () => {
        const username = `user-lenient-${crypto.randomUUID()}`;
        const ip = "unknown";
        for (let i = 0; i < 29; i++) recordFailedLogin(username, ip);
        expect(checkLoginLockout(username, ip)).toBeNull(); // still under LENIENT's 30
        recordFailedLogin(username, ip); // 30th attempt
        expect(checkLoginLockout(username, ip)).not.toBeNull();
    });

    it("keys are case-insensitive on username", () => {
        const ip = "10.0.0.6";
        const base = `CaseTest-${crypto.randomUUID()}`;
        for (let i = 0; i < 4; i++) recordFailedLogin(base.toUpperCase(), ip);
        // Same bucket reached via a different case of the same username.
        recordFailedLogin(base.toLowerCase(), ip);
        expect(checkLoginLockout(base, ip)).not.toBeNull();
    });

    it("recordSuccessfulLogin clears the bucket, allowing further attempts", () => {
        const username = `user-reset-${crypto.randomUUID()}`;
        const ip = "10.0.0.7";
        for (let i = 0; i < 4; i++) recordFailedLogin(username, ip); // under threshold
        expect(checkLoginLockout(username, ip)).toBeNull();
        recordSuccessfulLogin(username, ip);

        // Another 4 failures post-reset must still be under threshold — if
        // the bucket hadn't been cleared, this would be the 8th cumulative
        // attempt and would already be locked (STRICT threshold is 5).
        for (let i = 0; i < 4; i++) recordFailedLogin(username, ip);
        expect(checkLoginLockout(username, ip)).toBeNull();
    });

    it("recordSuccessfulLogin clears BOTH the STRICT and LENIENT buckets for the same (username, ip) key", () => {
        const username = `user-both-${crypto.randomUUID()}`;
        const ip = "unknown";
        const key = `${username.toLowerCase()}|${ip}`;
        // Simulate failures having landed in both policies (e.g. trust_proxy
        // flipped between attempts).
        for (let i = 0; i < 3; i++) recordFailure("login", key);
        for (let i = 0; i < 3; i++) recordFailure("login-untrusted", key);

        recordSuccessfulLogin(username, ip);

        expect(checkLockout("login", key)).toBeNull();
        expect(checkLockout("login-untrusted", key)).toBeNull();
    });

    it("locking one username does not lock a different username on the same ip", () => {
        const ip = "10.0.0.8";
        const victim = `victim-${crypto.randomUUID()}`;
        const bystander = `bystander-${crypto.randomUUID()}`;
        for (let i = 0; i < 5; i++) recordFailedLogin(victim, ip);
        expect(checkLoginLockout(victim, ip)).not.toBeNull();
        expect(checkLoginLockout(bystander, ip)).toBeNull();
    });
});

describe("auth/ratelimit: periodic sweep of stale buckets", () => {
    it("drops unlocked buckets that have been idle past STALE_AFTER_MS, but leaves currently-locked buckets alone", async () => {
        vi.useFakeTimers();
        try {
            // Force a fresh module load *while fake timers are active* so the
            // module-level `setInterval` sweep is registered against the fake
            // clock (a real setInterval registered before faking would not
            // respond to vi.advanceTimersByTime).
            delete (globalThis as unknown as Record<string, unknown>).__loom_credential_buckets__;
            delete (globalThis as unknown as Record<string, unknown>).__loom_credential_sweep__;
            vi.resetModules();
            const fresh = await import("@/lib/server/auth/ratelimit");

            fresh.recordFailure("bearer", "idle-key"); // 1 failure, never locked
            for (let i = 0; i < 5; i++) fresh.recordFailure("bearer", "locked-key"); // locked for 15 min

            const buckets = (globalThis as unknown as { __loom_credential_buckets__: Map<string, Map<string, unknown>> })
                .__loom_credential_buckets__;
            expect(buckets.get("bearer")?.has("idle-key")).toBe(true);
            expect(buckets.get("bearer")?.has("locked-key")).toBe(true);

            // First checkpoint: well before STALE_AFTER_MS (1h) and still
            // inside the lockout window (15 min) — nothing should be swept.
            vi.advanceTimersByTime(5 * 60 * 1000);
            expect(buckets.get("bearer")?.has("idle-key")).toBe(true);
            expect(buckets.get("bearer")?.has("locked-key")).toBe(true);

            // Second checkpoint: push well past both STALE_AFTER_MS (1h) and
            // the 15-minute lockout — by now `locked-key`'s lock has expired
            // too, so the sweep should delete both idle buckets.
            vi.advanceTimersByTime(65 * 60 * 1000);
            expect(buckets.get("bearer")?.has("idle-key")).toBe(false);
            expect(buckets.get("bearer")?.has("locked-key")).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe("auth/ratelimit: module-level environment guards", () => {
    it("in production, does not stash the buckets map or the sweep timer on globalThis", async () => {
        vi.stubEnv("NODE_ENV", "production");
        try {
            delete (globalThis as unknown as Record<string, unknown>).__loom_credential_buckets__;
            delete (globalThis as unknown as Record<string, unknown>).__loom_credential_sweep__;
            vi.resetModules();
            await import("@/lib/server/auth/ratelimit");
            expect((globalThis as unknown as Record<string, unknown>).__loom_credential_buckets__).toBeUndefined();
            expect((globalThis as unknown as Record<string, unknown>).__loom_credential_sweep__).toBeUndefined();
        } finally {
            vi.unstubAllEnvs();
            vi.resetModules();
        }
    });

    it("skips scheduling the sweep entirely when setInterval isn't available (e.g. an edge-like runtime)", async () => {
        vi.stubGlobal("setInterval", undefined);
        try {
            delete (globalThis as unknown as Record<string, unknown>).__loom_credential_sweep__;
            vi.resetModules();
            await expect(import("@/lib/server/auth/ratelimit")).resolves.toBeDefined();
            expect((globalThis as unknown as Record<string, unknown>).__loom_credential_sweep__).toBeUndefined();
        } finally {
            vi.unstubAllGlobals();
            vi.resetModules();
        }
    });
});
