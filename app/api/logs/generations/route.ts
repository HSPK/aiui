import "server-only";
import { NextRequest } from "next/server";
import { and, asc, count, desc, eq, like, SQL } from "drizzle-orm";
import { ensureInit } from "@/lib/server/init";
import { requireUser } from "@/lib/server/auth";
import { db, schema } from "@/lib/server/db";
import { handle, ok } from "@/lib/server/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseSort(sort: string) {
    const dir = sort.startsWith("-") ? "desc" : "asc";
    const field = sort.replace(/^-/, "");
    switch (field) {
        case "model_name": return dir === "desc" ? desc(schema.generationLogs.modelName) : asc(schema.generationLogs.modelName);
        case "status": return dir === "desc" ? desc(schema.generationLogs.status) : asc(schema.generationLogs.status);
        case "latency_ms": return dir === "desc" ? desc(schema.generationLogs.latencyMs) : asc(schema.generationLogs.latencyMs);
        case "created_at":
        default:
            return dir === "desc" ? desc(schema.generationLogs.createdAt) : asc(schema.generationLogs.createdAt);
    }
}

export async function GET(req: NextRequest) {
    try {
        await ensureInit();
        const me = await requireUser();
        const { searchParams } = new URL(req.url);
        const page = Math.max(1, Number(searchParams.get("page") ?? "1"));
        const pageSize = Math.min(500, Math.max(1, Number(searchParams.get("page_size") ?? "20")));
        const sort = searchParams.get("sort") ?? "-created_at";

        const filters: SQL[] = [eq(schema.generationLogs.isDeleted, false)];
        // Non-admin users only see their own logs
        if (me.role !== "admin") {
            filters.push(eq(schema.generationLogs.userId, me.id));
        } else {
            const userId = searchParams.get("user_id");
            if (userId) filters.push(eq(schema.generationLogs.userId, userId));
        }
        const modelName = searchParams.get("model_name");
        if (modelName) filters.push(like(schema.generationLogs.modelName, `%${modelName}%`));
        const status = searchParams.get("status");
        if (status === "pending" || status === "completed" || status === "failed") {
            filters.push(eq(schema.generationLogs.status, status));
        }

        const whereExpr = and(...filters);

        const total = db.select({ value: count() }).from(schema.generationLogs).where(whereExpr).get()?.value ?? 0;

        const rows = db.select({
            id: schema.generationLogs.id,
            user_id: schema.generationLogs.userId,
            model_name: schema.generationLogs.modelName,
            status: schema.generationLogs.status,
            output: schema.generationLogs.output,
            reason: schema.generationLogs.reason,
            created_at: schema.generationLogs.createdAt,
            updated_at: schema.generationLogs.updatedAt,
            is_deleted: schema.generationLogs.isDeleted,
            prompt_tokens: schema.generationLogs.promptTokens,
            completion_tokens: schema.generationLogs.completionTokens,
            total_tokens: schema.generationLogs.totalTokens,
            latency_ms: schema.generationLogs.latencyMs,
        })
            .from(schema.generationLogs)
            .where(whereExpr)
            .orderBy(parseSort(sort))
            .limit(pageSize)
            .offset((page - 1) * pageSize)
            .all();

        const items = rows.map((r) => ({
            id: r.id,
            user_id: r.user_id,
            model_name: r.model_name,
            status: r.status,
            input: "",
            output: r.output ?? "",
            reason: r.reason,
            created_at: r.created_at,
            updated_at: r.updated_at,
            is_deleted: !!r.is_deleted,
            prompt_tokens: r.prompt_tokens ?? undefined,
            completion_tokens: r.completion_tokens ?? undefined,
            total_tokens: r.total_tokens ?? undefined,
            latency_ms: r.latency_ms ?? undefined,
        }));

        return ok({ items, total, page, page_size: pageSize });
    } catch (err) {
        return handle(err);
    }
}
