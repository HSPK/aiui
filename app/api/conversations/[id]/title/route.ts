import "server-only";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { ensureInit } from "@/lib/server/init";
import { requireUser } from "@/lib/server/auth";
import { db, schema } from "@/lib/server/db";
import { badRequest, forbidden, handle, notFound, ok } from "@/lib/server/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    try {
        await ensureInit();
        const user = await requireUser();
        const { id } = await ctx.params;
        const url = new URL(req.url);
        const title = url.searchParams.get("title");
        if (!title || !title.trim()) throw badRequest("title is required");

        const conv = db.select().from(schema.conversations).where(eq(schema.conversations.id, id)).get();
        if (!conv) throw notFound("Conversation not found");
        if (conv.userId !== user.id) throw forbidden();

        db.update(schema.conversations)
            .set({ title: title.trim().slice(0, 100), updatedAt: new Date().toISOString() })
            .where(eq(schema.conversations.id, id))
            .run();
        return ok(null);
    } catch (err) {
        return handle(err);
    }
}
