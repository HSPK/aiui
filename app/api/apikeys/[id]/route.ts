import "server-only";
import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/server/db";
import { ensureInit } from "@/lib/server/init";
import { requireUser } from "@/lib/server/auth";
import { handle, notFound, ok } from "@/lib/server/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    try {
        await ensureInit();
        const user = await requireUser();
        const { id } = await ctx.params;
        const existing = db.select().from(schema.apiKeys)
            .where(and(eq(schema.apiKeys.id, id), eq(schema.apiKeys.userId, user.id)))
            .get();
        if (!existing) throw notFound("API key not found");
        db.delete(schema.apiKeys).where(eq(schema.apiKeys.id, id)).run();
        return ok(null);
    } catch (err) {
        return handle(err);
    }
}
