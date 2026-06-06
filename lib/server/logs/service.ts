import "server-only";
import { and, asc, count, desc, eq, like, type SQL } from "drizzle-orm";
import { db } from "../db";
import { generationLogs, users } from "../db/schema";
import { forbidden, notFound } from "../response";
import type { SessionUser } from "../auth";
import type { Paginated } from "@/lib/schemas/common";
import type { LogDetailDTO, LogListItemDTO, LogListQuery } from "@/lib/schemas/log";

function parseSortColumn(sort: string) {
    const dir = sort.startsWith("-") ? "desc" : "asc";
    const field = sort.replace(/^-/, "");
    const col =
        field === "model_name" ? generationLogs.modelName :
        field === "status" ? generationLogs.status :
        field === "first_token_latency_ms" ? generationLogs.firstTokenLatencyMs :
        field === "total_latency_ms" ? generationLogs.totalLatencyMs :
        generationLogs.createdAt;
    return dir === "desc" ? desc(col) : asc(col);
}

export function listLogs(user: SessionUser, query: LogListQuery): Paginated<LogListItemDTO> {
    const filters: SQL[] = [eq(generationLogs.isDeleted, false)];
    if (user.role !== "admin") {
        filters.push(eq(generationLogs.userId, user.id));
    } else if (query.user_id) {
        filters.push(eq(generationLogs.userId, query.user_id));
    }
    if (query.model_name) filters.push(like(generationLogs.modelName, `%${query.model_name}%`));
    if (query.capability) filters.push(eq(generationLogs.capability, query.capability));
    if (query.status) filters.push(eq(generationLogs.status, query.status));

    const whereExpr = and(...filters);

    const total = db.select({ value: count() }).from(generationLogs).where(whereExpr).get()?.value ?? 0;
    const rows = db
        .select({
            log: generationLogs,
            username: users.username,
        })
        .from(generationLogs)
        .leftJoin(users, eq(generationLogs.userId, users.id))
        .where(whereExpr)
        .orderBy(parseSortColumn(query.sort))
        .limit(query.page_size)
        .offset((query.page - 1) * query.page_size)
        .all();

    const items: LogListItemDTO[] = rows.map(({ log: r, username }) => ({
        id: r.id,
        user_id: r.userId,
        username: username ?? null,
        model_name: r.modelName,
        capability: r.capability ?? null,
        input_summary: r.inputSummary ?? null,
        status: r.status,
        input: r.inputSummary ?? "",
        output: r.output ?? "",
        reason: r.reason,
        prompt_tokens: r.promptTokens ?? null,
        completion_tokens: r.completionTokens ?? null,
        total_tokens: r.totalTokens ?? null,
        first_token_latency_ms: r.firstTokenLatencyMs ?? null,
        total_latency_ms: r.totalLatencyMs ?? null,
        created_at: r.createdAt,
        updated_at: r.updatedAt,
        is_deleted: !!r.isDeleted,
    }));
    return { items, total, page: query.page, page_size: query.page_size };
}

export function getLog(user: SessionUser, id: string): LogDetailDTO {
    const row = db
        .select({ log: generationLogs, username: users.username })
        .from(generationLogs)
        .leftJoin(users, eq(generationLogs.userId, users.id))
        .where(eq(generationLogs.id, id))
        .get();
    if (!row) throw notFound("Log not found");
    const { log, username } = row;
    if (user.role !== "admin" && log.userId !== user.id) throw forbidden();
    return {
        id: log.id,
        user_id: log.userId,
        username: username ?? null,
        model_name: log.modelName,
        capability: log.capability ?? null,
        input_summary: log.inputSummary ?? null,
        status: log.status,
        input: log.input ?? null,
        output: log.output ?? "",
        reason: log.reason,
        content: log.content ?? null,
        generation_kwargs: (log.generationKwargs ?? {}) as Record<string, unknown>,
        generation: log.generation ?? null,
        conversation_id: log.conversationId ?? undefined,
        message_id: log.messageId ?? undefined,
        prompt_tokens: log.promptTokens ?? null,
        completion_tokens: log.completionTokens ?? null,
        total_tokens: log.totalTokens ?? null,
        first_token_latency_ms: log.firstTokenLatencyMs ?? null,
        total_latency_ms: log.totalLatencyMs ?? null,
        created_at: log.createdAt,
        updated_at: log.updatedAt,
        is_deleted: !!log.isDeleted,
    };
}
