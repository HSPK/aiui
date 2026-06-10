import "server-only";

/**
 * In-memory failed-credential rate limiter. Process-local — sufficient
 * for single-instance deployments and the dev workflow. For a multi-
 * instance deployment behind a load balancer you'd want a shared store
 * (Redis), but that's a deploy-shape problem, not a code problem.
 *
 * Strategy: token bucket per (key) with a sliding window. After
 * `maxAttempts` failures within `windowMs`, the key is locked out for
 * `lockoutMs`. Each successful credential clears the bucket.
 *
 * Multiple buckets are kept under named "policies" so login attempts
 * and API-key brute force don't share state — locking one shouldn't
 * lock the other. Each policy carries its own (maxAttempts, windowMs,
 * lockoutMs) so we can apply LENIENT limits for victim-DoS-sensitive
 * scenarios (e.g. per-username login when IP is untrustable) vs the
 * STRICT defaults for cases where the attacker self-isolates (e.g.
 * per-token bearer probing).
 */

const SWEEP_INTERVAL_MS = 60 * 1000;
const STALE_AFTER_MS = 60 * 60 * 1000;

interface PolicyConfig {
    maxAttempts: number;
    windowMs: number;
    lockoutMs: number;
}

/** Strict default — used when the bucket key isolates the attacker
 *  from the victim (per-IP behind trusted proxy, or per-token-prefix
 *  for bearer). 5 attempts / 15 min lockout. */
const STRICT: PolicyConfig = {
    maxAttempts: 5,
    windowMs: 15 * 60 * 1000,
    lockoutMs: 15 * 60 * 1000,
};

/** Lenient — used when the bucket key is the VICTIM's identifier
 *  (per-username login when IP is untrustable). A strict per-victim
 *  lockout would let any attacker lock any known username from
 *  anywhere with 5 wrong-password POSTs and recur every 15 min →
 *  permanent admin DoS in the default config.
 *
 *  Trade-off: 30 attempts inside a 60s rolling window before a 60s
 *  lockout. Brute-force is still bounded (30/min vs the ~660/min
 *  bcrypt can handle), and victim DoS lasts at most 60s — annoying
 *  but recoverable. Operators who can stand up a real reverse proxy
 *  + set `LOOM_TRUST_PROXY=1` get the STRICT per-(username,IP) policy
 *  back. */
const LENIENT: PolicyConfig = {
    maxAttempts: 30,
    windowMs: 60 * 1000,
    lockoutMs: 60 * 1000,
};

const POLICIES = {
    login: STRICT,
    "login-untrusted": LENIENT,
    bearer: STRICT,
} satisfies Record<string, PolicyConfig>;

type PolicyName = keyof typeof POLICIES;

interface Bucket {
    attempts: number[];
    lockedUntil: number;
    lastSeen: number;
}

declare global {
    var __loom_credential_buckets__: Map<string, Map<string, Bucket>> | undefined;
    var __loom_credential_sweep__: ReturnType<typeof setInterval> | undefined;
}

const policies: Map<string, Map<string, Bucket>> =
    globalThis.__loom_credential_buckets__ ?? new Map();
if (process.env.NODE_ENV !== "production") globalThis.__loom_credential_buckets__ = policies;

// Periodic sweep so an attacker rotating identifiers (different
// usernames / IPs) can't grow the Map unboundedly and exhaust memory.
// Stale buckets — no activity for STALE_AFTER_MS AND not currently
// locked — are dropped. Cleared+reinstalled across HMR so each
// hot-reload doesn't leak a timer.
if (typeof setInterval !== "undefined") {
    if (globalThis.__loom_credential_sweep__) clearInterval(globalThis.__loom_credential_sweep__);
    const handle = setInterval(() => {
        const now = Date.now();
        for (const policy of policies.values()) {
            for (const [k, b] of policy) {
                if (b.lockedUntil > now) continue;
                if (now - b.lastSeen > STALE_AFTER_MS) policy.delete(k);
            }
        }
    }, SWEEP_INTERVAL_MS);
    // Node's `Timer.unref` lets the process exit even if a sweep is
    // pending — Next dev server lifecycle relies on this.
    handle.unref?.();
    if (process.env.NODE_ENV !== "production") globalThis.__loom_credential_sweep__ = handle;
}

function getPolicy(name: PolicyName): Map<string, Bucket> {
    let p = policies.get(name);
    if (!p) {
        p = new Map();
        policies.set(name, p);
    }
    return p;
}

/** Returns `null` if the key is not locked; otherwise the unix-ms
 *  timestamp when the lockout lifts. Caller should reject with 429. */
export function checkLockout(policy: PolicyName, key: string): number | null {
    const b = getPolicy(policy).get(key);
    if (!b) return null;
    if (b.lockedUntil > Date.now()) return b.lockedUntil;
    return null;
}

/** Record a failed credential attempt. Locks the key out when
 *  `maxAttempts` failures land within `windowMs` for this policy. */
export function recordFailure(policy: PolicyName, key: string): void {
    const cfg = POLICIES[policy];
    const p = getPolicy(policy);
    const now = Date.now();
    const b = p.get(key) ?? { attempts: [], lockedUntil: 0, lastSeen: now };
    b.lastSeen = now;
    b.attempts = b.attempts.filter((t) => now - t < cfg.windowMs);
    b.attempts.push(now);
    if (b.attempts.length >= cfg.maxAttempts) {
        b.lockedUntil = now + cfg.lockoutMs;
        b.attempts = [];
    }
    p.set(key, b);
}

/** Clear the bucket on success — don't penalise the user for a few
 *  typos before they remembered the password. */
export function recordSuccess(policy: PolicyName, key: string): void {
    getPolicy(policy).delete(key);
}

// ---- Convenience wrappers for callers that already know their policy.

/** Login lockout — pick STRICT per-(username,IP) when the caller IP is
 *  trustable, else LENIENT per-username (still bounded but won't lock
 *  out a specific user for 15min on a single attacker's whim). */
function loginPolicy(ip: string): PolicyName {
    return ip === "unknown" ? "login-untrusted" : "login";
}

export function checkLoginLockout(username: string, ip: string): number | null {
    return checkLockout(loginPolicy(ip), `${username.toLowerCase()}|${ip}`);
}
export function recordFailedLogin(username: string, ip: string): void {
    recordFailure(loginPolicy(ip), `${username.toLowerCase()}|${ip}`);
}
export function recordSuccessfulLogin(username: string, ip: string): void {
    // Clear BOTH buckets — the trust_proxy flag could have flipped
    // between the failed and successful attempt; we don't want either
    // bucket to keep state for this user after a real login.
    const k = `${username.toLowerCase()}|${ip}`;
    recordSuccess("login", k);
    recordSuccess("login-untrusted", k);
}

/** Per-IP lockout for Bearer API-key brute force. With 256-bit
 *  secrets the attack is computationally infeasible, but each
 *  failed lookup still hits SQLite — the limiter caps that DoS. */
export function checkBearerLockout(ip: string): number | null {
    return checkLockout("bearer", ip);
}
export function recordFailedBearer(ip: string): void {
    recordFailure("bearer", ip);
}

/** Extract the caller's IP from the request.
 *
 *  Proxy headers (`X-Forwarded-For`, `X-Real-IP`) are client-controlled
 *  and trivially forgeable from a direct-exposed deployment — an
 *  attacker rotates `X-Forwarded-For: 1.2.3.<N>` per request and each
 *  fake IP lands in a fresh bucket, defeating the per-IP rate limit
 *  entirely (the very DoS the limiter is supposed to cap).
 *
 *  Two-tier rule:
 *    - When `LOOM_TRUST_PROXY=1` is set, the deployment promises that
 *      a real reverse proxy is overwriting these headers — we trust
 *      the leftmost XFF entry / `X-Real-IP`.
 *    - Otherwise we IGNORE both headers and return the sentinel
 *      "unknown", which the bearer / login layer interprets as
 *      "untrustable IP, fall back to a per-token / per-username
 *      bucket so the limiter remains useful".
 *
 *  This makes the SAFE default (env unset) un-spoofable, and the OPT-IN
 *  proxy path requires the operator to explicitly acknowledge they're
 *  behind a header-injecting front end. */
export function callerIp(req: Request): string {
    if (process.env.LOOM_TRUST_PROXY !== "1") return "unknown";
    const xff = req.headers.get("x-forwarded-for");
    if (xff) {
        const first = xff.split(",")[0]?.trim();
        if (first) return first;
    }
    return req.headers.get("x-real-ip")?.trim() ?? "unknown";
}
