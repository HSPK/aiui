import "server-only";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { ensureInit } from "@/lib/server/init";
import { requireUser } from "@/lib/server/auth";
import { db, schema } from "@/lib/server/db";
import { badRequest, forbidden, handle, notFound, ok } from "@/lib/server/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    try {
        await ensureInit();
        const user = await requireUser();
        const { id } = await ctx.params;
        const url = new URL(req.url);
        const rating = url.searchParams.get("rating");
        const feedback = url.searchParams.get("feedback");
        if (rating !== "up" && rating !== "down" && rating !== "none") {
            throw badRequest("rating must be up, down, or none");
        }

        const message = db.select().from(schema.messages).where(eq(schema.messages.id, id)).get();
        if (!message) throw notFound("Message not found");

        const conv = db.select().from(schema.conversations).where(eq(schema.conversations.id, message.conversationId)).get();
        if (!conv || conv.userId !== user.id) throw forbidden();

        db.update(schema.messages)
            .set({
                rating: rating === "none" ? null : rating,
                feedback: feedback ?? null,
            })
            .where(eq(schema.messages.id, id))
            .run();

        return ok(null);
    } catch (err) {
        return handle(err);
    }
}
