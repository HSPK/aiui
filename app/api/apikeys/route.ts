import "server-only";
import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { eq, desc } from "drizzle-orm";
import { db, schema } from "@/lib/server/db";
import { ensureInit } from "@/lib/server/init";
import { requireUser, generateApiKey } from "@/lib/server/auth";
import { badRequest, handle, ok } from "@/lib/server/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
    try {
        await ensureInit();
        const user = await requireUser();
        const rows = db
            .select({
                id: schema.apiKeys.id,
                name: schema.apiKeys.name,
                prefix: schema.apiKeys.prefix,
                last_used_at: schema.apiKeys.lastUsedAt,
                created_at: schema.apiKeys.createdAt,
            })
            .from(schema.apiKeys)
            .where(eq(schema.apiKeys.userId, user.id))
            .orderBy(desc(schema.apiKeys.createdAt))
            .all();
        return ok(rows);
    } catch (err) {
        return handle(err);
    }
}

interface CreateBody {
    name?: string;
}

export async function POST(req: NextRequest) {
    try {
        await ensureInit();
        const user = await requireUser();
        const body = (await req.json()) as CreateBody;
        const name = body.name?.trim();
        if (!name) throw badRequest("API key name is required");

        const { plain, prefix, hash } = generateApiKey();
        const id = randomUUID();
        const createdAt = new Date().toISOString();

        db.insert(schema.apiKeys).values({
            id,
            userId: user.id,
            name,
            prefix,
            keyHash: hash,
        }).run();

        return ok({
            id,
            name,
            prefix,
            last_used_at: null,
            created_at: createdAt,
            key: plain,
        });
    } catch (err) {
        return handle(err);
    }
}
