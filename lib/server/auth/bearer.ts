import "server-only";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { apiKeys, users } from "../db/schema";
import { generateRandomToken, sha256 } from "../crypto";
import { tooManyRequests, unauthorized } from "../response";
import { callerIp, checkBearerLockout, recordFailedBearer } from "./ratelimit";
import { userToSession, type SessionUser } from "./types";

export const API_KEY_PREFIX = "sk-loom-";

export function generateApiKey(): { plain: string; prefix: string; hash: string } {
    const secret = generateRandomToken(32);
    const plain = `${API_KEY_PREFIX}${secret}`;
    return { plain, prefix: plain.slice(0, 12), hash: sha256(plain) };
}

/** Per-request rate-limit bucket key. When the caller is behind a
 *  trustworthy reverse proxy injecting `X-Forwarded-For` /
 *  `X-Real-IP` we use the IP. Otherwise (`callerIp()` returns the
 *  "unknown" sentinel — common for direct-exposed self-hosted
 *  deployments, dev server, etc.) we fall back to a token-prefix
 *  bucket so a brute-forcer can't collapse every legitimate key into
 *  a single global lockout. With 256-bit secrets the per-prefix
 *  attempts an attacker can mount are immaterial; the point of the
 *  bucket is to bound the SQLite SELECT cost. */
function bucketKey(ip: string, token: string | null): string {
    if (ip !== "unknown") return `ip:${ip}`;
    if (!token) return "ip:unknown|prefix:none";
    return `ip:unknown|prefix:${sha256(token).slice(0, 16)}`;
}

export async function authenticateBearer(req: Request): Promise<SessionUser> {
    const ip = callerIp(req);
    const header = req.headers.get("Authorization") || "";
    const match = header.match(/^Bearer\s+(.+)$/i);
    const token = match ? match[1].trim() : null;

    const key = bucketKey(ip, token);
    const lockedUntil = checkBearerLockout(key);
    if (lockedUntil) {
        // 429 (not 401) + standard Retry-After so SDK clients can
        // back off automatically — and don't mistake a temporary
        // lockout for a permanently-invalid key (which would prompt
        // operators to rotate good credentials).
        const seconds = Math.ceil((lockedUntil - Date.now()) / 1000);
        throw tooManyRequests(`Too many invalid keys — try again in ${seconds}s`, seconds);
    }

    if (!token) {
        // Missing token does NOT consume the lockout bucket — the
        // bucket exists to bound the cost of brute-force lookups
        // (each invalid key triggers a SELECT). A missing-token
        // request is zero-cost and not a credential guess. Charging
        // it would let a trivial `Authorization: Bearer ` spam from
        // any caller on a shared IP DoS legitimate key holders.
        throw unauthorized("Missing Bearer token");
    }
    const hash = sha256(token);

    const row = db
        .select({ user: users, apiKey: apiKeys })
        .from(apiKeys)
        .innerJoin(users, eq(users.id, apiKeys.userId))
        .where(eq(apiKeys.keyHash, hash))
        .get();

    if (!row) {
        // Real credential guess with DB cost → count it.
        recordFailedBearer(key);
        throw unauthorized("Invalid API key");
    }

    if (row.apiKey.expiresAt) {
        const exp = Date.parse(
            row.apiKey.expiresAt.endsWith("Z") || TZ_SUFFIX_RE.test(row.apiKey.expiresAt)
                ? row.apiKey.expiresAt
                : row.apiKey.expiresAt + "Z",
        );
        if (!Number.isFinite(exp)) {
            // Unparseable timestamp on a key row — likely a corrupted
            // migration or a manual SQL edit. Fail closed (deny) rather
            // than fall through to success: silently accepting an
            // unparseable expiresAt is the dangerous default.
            console.warn(
                `[auth] api_key ${row.apiKey.id} has unparseable expires_at "${row.apiKey.expiresAt}" — denying`,
            );
            throw unauthorized("API key has invalid expiration");
        }
        if (Date.now() >= exp) {
            // Expired key is NOT a brute-force vector (attacker would
            // need a real key to even reach this branch). Don't count
            // it — otherwise a legitimate user with 10 services still
            // retrying their expired key locks out every other key
            // holder on shared IPs.
            throw unauthorized("API key has expired");
        }
    }

    bumpLastUsed(row.apiKey.id, row.apiKey.lastUsedAt);
    return userToSession(row.user);
}

// Debounce last_used_at writes — an active API client can hammer
// gateway requests, and a per-request UPDATE writes back into
// `api_keys` thousands of times for what is essentially a "seen
// recently" stat. Only persist when the existing timestamp is more
// than LAST_USED_DEBOUNCE_MS stale.
const LAST_USED_DEBOUNCE_MS = 60_000;
const TZ_SUFFIX_RE = /[+-]\d\d:?\d\d$/;

function bumpLastUsed(keyId: string, prev: string | null): void {
    if (prev) {
        const t = Date.parse(prev.endsWith("Z") || TZ_SUFFIX_RE.test(prev) ? prev : prev + "Z");
        if (Number.isFinite(t) && Date.now() - t < LAST_USED_DEBOUNCE_MS) return;
    }
    db.update(apiKeys)
        .set({ lastUsedAt: new Date().toISOString() })
        .where(eq(apiKeys.id, keyId))
        .run();
}
