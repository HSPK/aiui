import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db";
import { apiKeys } from "../db/schema";
import { generateApiKey } from "../auth";
import { notFound } from "../response";
import type { ApiKeyCreateInput, ApiKeyCreatedDTO, ApiKeyDTO } from "@/lib/schemas/apikey";

export function listApiKeys(userId: string): ApiKeyDTO[] {
    return db
        .select({
            id: apiKeys.id,
            name: apiKeys.name,
            prefix: apiKeys.prefix,
            last_used_at: apiKeys.lastUsedAt,
            expires_at: apiKeys.expiresAt,
            created_at: apiKeys.createdAt,
        })
        .from(apiKeys)
        .where(eq(apiKeys.userId, userId))
        .orderBy(desc(apiKeys.createdAt))
        .all();
}

export function createUserApiKey(userId: string, input: ApiKeyCreateInput): ApiKeyCreatedDTO {
    const { plain, prefix, hash } = generateApiKey();
    const id = randomUUID();
    // Use a single Node-side timestamp for BOTH the insert and the
    // response. The column's `default(now)` would compute SQLite's
    // `CURRENT_TIMESTAMP` (`YYYY-MM-DD HH:MM:SS`) which mismatches the
    // ISO-Z string the rest of the app uses — and the subsequent GET
    // `/apikeys` would return a value the FE doesn't recognise as the
    // same row.
    const createdAt = new Date().toISOString();
    const expiresAt = input.expires_at ?? null;

    db.insert(apiKeys).values({
        id,
        userId,
        name: input.name.trim(),
        prefix,
        keyHash: hash,
        expiresAt,
        createdAt,
    }).run();

    return {
        id,
        name: input.name.trim(),
        prefix,
        last_used_at: null,
        expires_at: expiresAt,
        created_at: createdAt,
        key: plain,
    };
}

export function deleteUserApiKey(userId: string, id: string): void {
    // Single scoped statement: avoids TOCTOU between SELECT and DELETE
    // and saves a roundtrip. `res.changes === 0` proves the row either
    // didn't exist or didn't belong to this user — either way 404.
    const res = db.delete(apiKeys)
        .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId)))
        .run();
    if (res.changes === 0) throw notFound("API key not found");
}
