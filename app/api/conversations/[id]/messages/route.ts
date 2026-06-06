import "server-only";
import { NextRequest } from "next/server";
import { and, asc, count, desc, eq } from "drizzle-orm";
import { ensureInit } from "@/lib/server/init";
import { requireUser } from "@/lib/server/auth";
import { db, schema } from "@/lib/server/db";
import { forbidden, handle, notFound, ok } from "@/lib/server/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    try {
        await ensureInit();
        const user = await requireUser();
        const { id } = await ctx.params;
        const { searchParams } = new URL(req.url);
        const page = Math.max(1, Number(searchParams.get("page") ?? "1"));
        const pageSize = Math.min(500, Math.max(1, Number(searchParams.get("page_size") ?? "50")));
        const sort = searchParams.get("sort") ?? "-created_at";

        const conv = db.select().from(schema.conversations).where(eq(schema.conversations.id, id)).get();
        if (!conv) throw notFound("Conversation not found");
        if (conv.userId !== user.id) throw forbidden();

        const orderExpr = sort.startsWith("-") ? desc(schema.messages.createdAt) : asc(schema.messages.createdAt);
        const whereExpr = and(eq(schema.messages.conversationId, id), eq(schema.messages.isActive, true));

        const total = db.select({ value: count() }).from(schema.messages).where(whereExpr).get()?.value ?? 0;
        const rows = db.select().from(schema.messages)
            .where(whereExpr)
            .orderBy(orderExpr)
            .limit(pageSize)
            .offset((page - 1) * pageSize)
            .all();

        const items = rows.map((m) => ({
            id: m.id,
            conversation_id: m.conversationId,
            role: m.role,
            content: m.content,
            reasoning_content: m.reasoningContent ?? undefined,
            model_id: m.modelId ?? undefined,
            generation_id: m.generationId ?? undefined,
            parent_id: m.parentId ?? undefined,
            meta: m.meta ?? undefined,
            is_active: !!m.isActive,
            rating: m.rating ?? undefined,
            feedback: m.feedback ?? undefined,
            created_at: m.createdAt,
        }));

        return ok({ items, total, page, page_size: pageSize });
    } catch (err) {
        return handle(err);
    }
}
