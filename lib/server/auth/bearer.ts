import "server-only";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { apiKeys, users } from "../db/schema";
import { generateRandomToken, sha256 } from "../crypto";
import { unauthorized } from "../response";
import { userToSession, type SessionUser } from "./types";

export const API_KEY_PREFIX = "sk-aiui-";

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

    const rows = db
        .select({ user: users, apiKey: apiKeys })
        .from(apiKeys)
        .innerJoin(users, eq(users.id, apiKeys.userId))
        .where(eq(apiKeys.keyHash, hash))
        .all();

    const row = rows[0];
    if (!row) throw unauthorized("Invalid API key");

    db.update(apiKeys)
        .set({ lastUsedAt: new Date().toISOString() })
        .where(eq(apiKeys.id, row.apiKey.id))
        .run();

    return userToSession(row.user);
}
