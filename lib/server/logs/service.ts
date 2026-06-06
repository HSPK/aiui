import "server-only";
import { and, asc, count, desc, eq, like, type SQL } from "drizzle-orm";
import { db } from "../db";
import { generationLogs } from "../db/schema";
import { forbidden, notFound } from "../response";
import type { SessionUser } from "../auth";
import type { LogListQuery } from "./schemas";

export interface LogListItemDTO {
    id: string;
    user_id: string;
    model_name: string;
    capability: string | null;
    input_summary: string | null;
    status: "pending" | "completed" | "failed";
    input: unknown;
    output: string;
    reason: string | null;
    prompt_tokens?: number | null;
    completion_tokens?: number | null;
    total_tokens?: number | null;
    latency_ms?: number | null;
    created_at: string;
    updated_at: string;
    is_deleted: boolean;
}

export interface LogDetailDTO extends LogListItemDTO {
    content: unknown;
    generation_kwargs: Record<string, unknown>;
    generation: Record<string, unknown> | null;
    conversation_id?: string;
    message_id?: string;
}

function parseSortColumn(sort: string) {
    const dir = sort.startsWith("-") ? "desc" : "asc";
    const field = sort.replace(/^-/, "");
    const col =
        field === "model_name" ? generationLogs.modelName :
        field === "status" ? generationLogs.status :
        field === "latency_ms" ? generationLogs.latencyMs :
        generationLogs.createdAt;
    return dir === "desc" ? desc(col) : asc(col);
}

export function listLogs(user: SessionUser, query: LogListQuery): {
    items: LogListItemDTO[]; total: number; page: number; page_size: number;
} {
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
    const rows = db.select().from(generationLogs)
        .where(whereExpr)
        .orderBy(parseSortColumn(query.sort))
        .limit(query.page_size)
        .offset((query.page - 1) * query.page_size)
        .all();

    const items: LogListItemDTO[] = rows.map((r) => ({
        id: r.id,
        user_id: r.userId,
        model_name: r.modelName,
        capability: r.capability ?? null,
        input_summary: r.inputSummary ?? null,
        status: r.status,
        input: r.inputSummary ?? "",
        output: r.output ?? "",
        reason: r.reason,
        prompt_tokens: r.promptTokens ?? undefined,
        completion_tokens: r.completionTokens ?? undefined,
        total_tokens: r.totalTokens ?? undefined,
        latency_ms: r.latencyMs ?? undefined,
        created_at: r.createdAt,
        updated_at: r.updatedAt,
        is_deleted: !!r.isDeleted,
    }));
    return { items, total, page: query.page, page_size: query.page_size };
}

export function getLog(user: SessionUser, id: string): LogDetailDTO {
    const log = db.select().from(generationLogs).where(eq(generationLogs.id, id)).get();
    if (!log) throw notFound("Log not found");
    if (user.role !== "admin" && log.userId !== user.id) throw forbidden();
    return {
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
        generation_kwargs: (log.generationKwargs ?? {}) as Record<string, unknown>,
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
    };
}
