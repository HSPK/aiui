import "server-only";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { ensureInit } from "@/lib/server/init";
import { requireUser } from "@/lib/server/auth";
import { db, schema } from "@/lib/server/db";
import { forbidden, handle, notFound, ok } from "@/lib/server/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    try {
        await ensureInit();
        const user = await requireUser();
        const { id } = await ctx.params;
        const conv = db.select().from(schema.conversations).where(eq(schema.conversations.id, id)).get();
        if (!conv) throw notFound("Conversation not found");
        if (conv.userId !== user.id) throw forbidden();
        db.update(schema.conversations)
            .set({ isDeleted: true, updatedAt: new Date().toISOString() })
            .where(eq(schema.conversations.id, id))
            .run();
        return ok(null);
    } catch (err) {
        return handle(err);
    }
}
