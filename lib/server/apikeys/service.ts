import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db";
import { apiKeys } from "../db/schema";
import { generateApiKey } from "../auth";
import { notFound } from "../response";
import type { ApiKeyCreateInput } from "./schemas";

export interface ApiKeyDTO {
    id: string;
    name: string;
    prefix: string;
    last_used_at: string | null;
    created_at: string;
}

export function listApiKeys(userId: string): ApiKeyDTO[] {
    return db
        .select({
            id: apiKeys.id,
            name: apiKeys.name,
            prefix: apiKeys.prefix,
            last_used_at: apiKeys.lastUsedAt,
            created_at: apiKeys.createdAt,
        })
        .from(apiKeys)
        .where(eq(apiKeys.userId, userId))
        .orderBy(desc(apiKeys.createdAt))
        .all();
}

export function createUserApiKey(userId: string, input: ApiKeyCreateInput): ApiKeyDTO & { key: string } {
    const { plain, prefix, hash } = generateApiKey();
    const id = randomUUID();
    const createdAt = new Date().toISOString();

    db.insert(apiKeys).values({
        id,
        userId,
        name: input.name.trim(),
        prefix,
        keyHash: hash,
    }).run();

    return {
        id,
        name: input.name.trim(),
        prefix,
        last_used_at: null,
        created_at: createdAt,
        key: plain,
    };
}

export function deleteUserApiKey(userId: string, id: string): void {
    const existing = db.select().from(apiKeys)
        .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId)))
        .get();
    if (!existing) throw notFound("API key not found");
    db.delete(apiKeys).where(eq(apiKeys.id, id)).run();
}
