import "server-only";
import { and, asc, count, desc, eq, inArray, like, sql, type SQL } from "drizzle-orm";
import { db } from "../db";
import { conversations, messages } from "../db/schema";
import { forbidden, notFound } from "../response";
import type { Paginated } from "@/lib/schemas/common";
import type {
    ConversationDTO,
    ConversationListQuery,
    ConversationTitleInput,
    MessageDTO,
    MessageListQuery,
} from "@/lib/schemas/conversation";

export function listConversations(userId: string, query: ConversationListQuery): Paginated<ConversationDTO> {
    const filters: SQL[] = [
        eq(conversations.userId, userId),
        eq(conversations.isDeleted, false),
    ];
    if (query.keyword) {
        filters.push(like(conversations.title, `%${query.keyword}%`));
    }
    const whereExpr = and(...filters);

    const total = db.select({ value: count() }).from(conversations).where(whereExpr).get()?.value ?? 0;
    const rows = db.select().from(conversations)
        .where(whereExpr)
        .orderBy(desc(conversations.updatedAt))
        .limit(query.page_size)
        .offset((query.page - 1) * query.page_size)
        .all();

    const items: ConversationDTO[] = rows.map((c) => ({
        id: c.id,
        user_id: c.userId,
        title: c.title,
        config: (c.config ?? {}) as Record<string, unknown>,
        group_id: c.groupId ?? undefined,
        created_at: c.createdAt,
        updated_at: c.updatedAt,
        is_deleted: !!c.isDeleted,
    }));
    return { items, total, page: query.page, page_size: query.page_size };
}

function loadOwned(userId: string, id: string) {
    const conv = db.select().from(conversations).where(eq(conversations.id, id)).get();
    if (!conv) throw notFound("Conversation not found");
    if (conv.userId !== userId) throw forbidden();
    return conv;
}

export function softDeleteConversation(userId: string, id: string): void {
    loadOwned(userId, id);
    db.update(conversations)
        .set({ isDeleted: true, updatedAt: new Date().toISOString() })
        .where(eq(conversations.id, id))
        .run();
}

export function updateConversationTitle(userId: string, id: string, input: ConversationTitleInput): void {
    loadOwned(userId, id);
    db.update(conversations)
        .set({ title: input.title.slice(0, 100), updatedAt: new Date().toISOString() })
        .where(eq(conversations.id, id))
        .run();
}

// ---- messages under a conversation ----

export function listMessages(userId: string, conversationId: string, query: MessageListQuery): Paginated<MessageDTO> {
    loadOwned(userId, conversationId);

    const orderExpr = query.sort.startsWith("-") ? desc(messages.createdAt) : asc(messages.createdAt);
    const whereExpr = and(eq(messages.conversationId, conversationId), eq(messages.isActive, true));

    const total = db.select({ value: count() }).from(messages).where(whereExpr).get()?.value ?? 0;
    const rows = db.select().from(messages)
        .where(whereExpr)
        .orderBy(orderExpr)
        .limit(query.page_size)
        .offset((query.page - 1) * query.page_size)
        .all();

    // Pull in ancestors so a page is always subtree-complete: a tool
    // row needs its parent assistant (whose tool_call parts contain
    // the call ids that link the rows), an assistant needs its parent
    // user. Without this, paginating a tool-heavy turn breaks the FE
    // fold (orphan tool rows can't bind back to a missing parent and
    // get dropped, leaving an empty render).
    //
    // Recursive CTE: one round-trip walks the parent chain to root
    // instead of O(depth) `IN (...)` round-trips. SQLite cap protects
    // against pathological cycles in case of corrupted parent_id data.
    const haveIds = new Set(rows.map((r) => r.id));
    const seedParents = Array.from(
        new Set(
            rows.map((r) => r.parentId)
                .filter((id): id is string => !!id && !haveIds.has(id)),
        ),
    );
    let ancestors: typeof rows = [];
    if (seedParents.length > 0) {
        const seedJson = JSON.stringify(seedParents);
        ancestors = db.all<typeof messages.$inferSelect>(sql`
            WITH RECURSIVE ancestors(id, depth) AS (
                SELECT value AS id, 0 AS depth FROM json_each(${seedJson})
                UNION
                SELECT m.parent_id, a.depth + 1
                FROM messages m
                JOIN ancestors a ON m.id = a.id
                WHERE m.parent_id IS NOT NULL
                  AND m.conversation_id = ${conversationId}
                  AND a.depth < 64
            )
            SELECT m.* FROM messages m
            JOIN ancestors a ON m.id = a.id
            WHERE m.conversation_id = ${conversationId}
        `);
        for (const a of ancestors) haveIds.add(a.id);
    }

    // Also descend: for every loaded assistant, pull in any `role:
    // "tool"` rows that point back at it via parent_id. The newest-
    // first page window can stop mid-turn (e.g. only 20 of 31 tool
    // results land in the page), which leaves the assistant's
    // tool_call parts unresolved on the FE and they render as
    // "running" forever. Tool rows have no children so this is a
    // single non-recursive pass.
    const assistantIds = [...rows, ...ancestors]
        .filter((r) => r.role === "assistant")
        .map((r) => r.id);
    const descendants: typeof rows = [];
    if (assistantIds.length > 0) {
        const toolChildren = db.select().from(messages)
            .where(and(
                eq(messages.conversationId, conversationId),
                eq(messages.isActive, true),
                eq(messages.role, "tool"),
                inArray(messages.parentId, assistantIds),
            ))
            .all();
        for (const t of toolChildren) {
            if (haveIds.has(t.id)) continue;
            haveIds.add(t.id);
            descendants.push(t);
        }
    }

    // Merge + dedup, preserving the requested sort order.
    const merged = [...rows, ...ancestors, ...descendants].sort((a, b) => {
        const cmp = a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
        return query.sort.startsWith("-") ? -cmp : cmp;
    });

    const items: MessageDTO[] = merged.map((m) => ({
        id: m.id,
        conversation_id: m.conversationId,
        role: m.role,
        content: m.content,
        reasoning_content: m.reasoningContent ?? undefined,
        model_id: m.modelId ?? undefined,
        generation_id: m.generationId ?? undefined,
        parent_id: m.parentId ?? undefined,
        is_active: !!m.isActive,
        rating: m.rating ?? undefined,
        feedback: m.feedback ?? undefined,
        error: m.error ?? undefined,
        created_at: m.createdAt,
    }));
    return { items, total, page: query.page, page_size: query.page_size };
}
