import "server-only";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { apiKeys, users } from "../db/schema";
import { generateRandomToken, sha256 } from "../crypto";
import { unauthorized } from "../response";
import { userToSession, type SessionUser } from "./types";

export const API_KEY_PREFIX = "sk-loom-";

export function generateApiKey(): { plain: string; prefix: string; hash: string } {
    const secret = generateRandomToken(32);
    const plain = `${API_KEY_PREFIX}${secret}`;
    return { plain, prefix: plain.slice(0, 12), hash: sha256(plain) };
}

export async function authenticateBearer(req: Request): Promise<SessionUser> {
    const header = req.headers.get("Authorization") || "";
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) throw unauthorized("Missing Bearer token");
    const token = match[1].trim();
    const hash = sha256(token);

    const row = db
        .select({ user: users, apiKey: apiKeys })
        .from(apiKeys)
        .innerJoin(users, eq(users.id, apiKeys.userId))
        .where(eq(apiKeys.keyHash, hash))
        .get();

    if (!row) throw unauthorized("Invalid API key");

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
