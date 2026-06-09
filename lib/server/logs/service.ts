import "server-only";
import { and, asc, count, desc, eq, like, type SQL } from "drizzle-orm";
import { db } from "../db";
import { generationLogs, users } from "../db/schema";
import { persistImageArtifacts } from "../gateway/artifacts";
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
    // NOTE: omit the heavy JSON columns (input, content, generation,
    // generation_kwargs) from the list query — list rows only render
    // input_summary / output. Selecting them used to ship MB-sized b64
    // blobs over the wire even when only the table view was needed.
    const rows = db
        .select({
            log: {
                id: generationLogs.id,
                userId: generationLogs.userId,
                modelName: generationLogs.modelName,
                capability: generationLogs.capability,
                inputSummary: generationLogs.inputSummary,
                status: generationLogs.status,
                output: generationLogs.output,
                reason: generationLogs.reason,
                promptTokens: generationLogs.promptTokens,
                completionTokens: generationLogs.completionTokens,
                totalTokens: generationLogs.totalTokens,
                firstTokenLatencyMs: generationLogs.firstTokenLatencyMs,
                totalLatencyMs: generationLogs.totalLatencyMs,
                createdAt: generationLogs.createdAt,
                updatedAt: generationLogs.updatedAt,
                isDeleted: generationLogs.isDeleted,
            },
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

/** True when the log payload still has un-persisted b64_json blobs
 *  inline. Old logs written before artifact persistence will return
 *  true on first read — we lazily migrate them in `getLog`. */
function hasInlineB64(generation: unknown): boolean {
    if (!generation || typeof generation !== "object") return false;
    const data = (generation as { data?: unknown }).data;
    if (!Array.isArray(data)) return false;
    return data.some(
        (d) => d && typeof d === "object" && typeof (d as { b64_json?: unknown }).b64_json === "string",
    );
}

export async function getLog(user: SessionUser, id: string): Promise<LogDetailDTO> {
    const row = db
        .select({ log: generationLogs, username: users.username })
        .from(generationLogs)
        .leftJoin(users, eq(generationLogs.userId, users.id))
        .where(eq(generationLogs.id, id))
        .get();
    if (!row) throw notFound("Log not found");
    const { log, username } = row;
    if (user.role !== "admin" && log.userId !== user.id) throw forbidden();

    // Lazy migration: legacy image logs written before artifact
    // persistence still carry MB-sized b64 inline. Strip + persist on
    // first read so subsequent reads are fast AND the gallery works.
    let generation = log.generation as Record<string, unknown> | null;
    if (log.capability === "image" && generation && hasInlineB64(generation)) {
        try {
            const cloned = structuredClone(generation);
            await persistImageArtifacts(log.id, cloned);
            generation = cloned;
            db.update(generationLogs)
                .set({ generation: cloned })
                .where(eq(generationLogs.id, log.id))
                .run();
        } catch (err) {
            console.error("[loom] lazy artifact migration failed for log", log.id, err);
        }
    }

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
        generation_kwargs: (log.generationKwargs ?? {}) as Record<string, unknown>,
        generation: generation ?? null,
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

/** Lightweight gate for artifact reads. The image-gallery route gets
 *  hit once per image — running the full `getLog` (which streams
 *  multi-MB JSON columns + does lazy migration) just to confirm
 *  ownership is wasteful. This reads only the id+userId so the
 *  ownership predicate fits in the index. */
export function assertLogReadable(user: SessionUser, id: string): void {
    const row = db
        .select({ userId: generationLogs.userId })
        .from(generationLogs)
        .where(eq(generationLogs.id, id))
        .get();
    if (!row) throw notFound("Log not found");
    if (user.role !== "admin" && row.userId !== user.id) throw forbidden();
}
