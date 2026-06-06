import "server-only";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { ensureInit } from "@/lib/server/init";
import { requireUser } from "@/lib/server/auth";
import { db, schema } from "@/lib/server/db";
import { forbidden, handle, notFound, ok } from "@/lib/server/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    try {
        await ensureInit();
        const me = await requireUser();
        const { id } = await ctx.params;
        const log = db.select().from(schema.generationLogs).where(eq(schema.generationLogs.id, id)).get();
        if (!log) throw notFound("Log not found");
        if (me.role !== "admin" && log.userId !== me.id) throw forbidden();
        return ok({
            id: log.id,
            user_id: log.userId,
            model_name: log.modelName,
            capability: log.capability ?? null,
            input_summary: log.inputSummary ?? null,
            status: log.status,
            input: log.input ?? null,
            output: log.output ?? "",
            reason: log.reason,
            content: log.content ?? null,
            generation_kwargs: log.generationKwargs ?? {},
            generation: log.generation ?? null,
            conversation_id: log.conversationId ?? undefined,
            message_id: log.messageId ?? undefined,
            prompt_tokens: log.promptTokens ?? undefined,
            completion_tokens: log.completionTokens ?? undefined,
            total_tokens: log.totalTokens ?? undefined,
            latency_ms: log.latencyMs ?? undefined,
            created_at: log.createdAt,
            updated_at: log.updatedAt,
            is_deleted: !!log.isDeleted,
        });
    } catch (err) {
        return handle(err);
    }
}
