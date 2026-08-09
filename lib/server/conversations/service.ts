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
    const conv = loadOwned(userId, id);
    // Compare-and-swap: when caller supplies `expected_title`, only
    // write if the row's CURRENT title still matches. Used by the
    // background title-generator to avoid silently clobbering a
    // manual rename that landed between snapshot-time and the LLM
    // result arriving. Mismatch is silent (200 OK, no-op) — the
    // caller's wire shape already conveyed "best-effort: skip if
    // changed". Without this guard, async background updaters race
    // with synchronous user edits and the user's choice loses.
    if (input.expected_title !== undefined && conv.title !== input.expected_title) {
        return;
    }
    // Trust the validator — `conversationTitleSchema.max(200)` already
    // capped the input. Earlier code did `.slice(0, 100)` here which
    // silently truncated any 101–200 char title that passed validation,
    // returning 200 OK while data was lost. If we want a tighter cap
    // the schema is the place — single source of truth.
    db.update(conversations)
        .set({ title: input.title, updatedAt: new Date().toISOString() })
        .where(eq(conversations.id, id))
        .run();
}

// ---- messages under a conversation ----

export function listMessages(userId: string, conversationId: string, query: MessageListQuery): Paginated<MessageDTO> {
    loadOwned(userId, conversationId);

    // Compose (created_at, id) ordering — created_at alone is unstable
    // because ms-precision ISO timestamps frequently collide when the
    // tool-execution orchestrator inserts an assistant + N tool rows
    // inside the same handler tick. Without an `id` tiebreaker, SQLite
    // is free to return tied rows in different orders across calls,
    // so a row could appear on page 1 in one call and page 2 in the
    // next (duplicate via dedup or — worse — silently skipped). The
    // merge-sort below applies the same tiebreaker.
    const orderExprs = query.sort.startsWith("-")
        ? [desc(messages.createdAt), desc(messages.id)]
        : [asc(messages.createdAt), asc(messages.id)];
    const whereExpr = and(eq(messages.conversationId, conversationId), eq(messages.isActive, true));

    const total = db.select({ value: count() }).from(messages).where(whereExpr).get()?.value ?? 0;
    const rows = db.select().from(messages)
        .where(whereExpr)
        .orderBy(...orderExprs)
        .limit(query.page_size)
        .offset((query.page - 1) * query.page_size)
        .all();

    // Pull in a few ancestors so a page is subtree-complete at its
    // edge: a tool row needs its parent assistant (whose tool_call
    // parts carry the ids that link the two), and that assistant reads
    // better with the user turn that prompted it.
    //
    // The walk is depth-capped, and the cap is the whole point. It used
    // to climb to the root (depth < 64), which quietly defeated
    // pagination: in a linear chat every message's parent is its
    // predecessor, so seeding from the oldest row of ANY page walked
    // the entire history back to message one. Measured on a 60-message
    // conversation, `page_size=20` returned all 60 — opening a chat
    // fetched and rendered it from the beginning instead of the end.
    //
    // Two levels is enough for the stated purpose (tool -> assistant ->
    // user) and the FE degrades gracefully past it: `foldToolMessages`
    // binds results to calls by `tool_call_id` rather than `parent_id`,
    // and deliberately keeps orphan tool rows visible when their parent
    // hasn't loaded. Anything older arrives via the next page.
    //
    // Recursive CTE: one round-trip walks the chain instead of O(depth)
    // `IN (...)` round-trips, and the cap doubles as protection against
    // a cycle in corrupted parent_id data.
    const ANCESTOR_COMPLETION_DEPTH = 2;
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
        // The CTE resolves *ids only*. It used to `SELECT m.*` straight
        // into `db.all<typeof messages.$inferSelect>(...)`, but that
        // generic is a type assertion with no runtime counterpart:
        // raw SQL bypasses Drizzle's column mapping, so every row came
        // back with snake_case keys and unparsed values. `createdAt`
        // was `undefined` (killing both the DTO timestamp and the sort
        // comparator below, which then treated every ancestor as tied)
        // and `content` stayed a JSON *string*, which the FE rendered
        // literally as `[{"type":"text",...}]`. Re-selecting the ids
        // through the query builder puts mapping and json decoding
        // back in Drizzle's hands, where the rest of this function
        // already assumes they happened.
        const ancestorIds = db.all<{ id: string }>(sql`
            WITH RECURSIVE ancestors(id, depth) AS (
                SELECT value AS id, 0 AS depth FROM json_each(${seedJson})
                UNION
                SELECT m.parent_id, a.depth + 1
                FROM messages m
                JOIN ancestors a ON m.id = a.id
                WHERE m.parent_id IS NOT NULL
                  AND m.conversation_id = ${conversationId}
                  AND a.depth < ${ANCESTOR_COMPLETION_DEPTH}
            )
            SELECT m.id AS id FROM messages m
            JOIN ancestors a ON m.id = a.id
            WHERE m.conversation_id = ${conversationId}
        `).map((r) => r.id)
            // The walk climbs to the root, so it re-reports rows the page
            // window already returned. Without this the concatenation
            // below emits them twice — measured at 10 duplicates in a
            // 38-message conversation.
            .filter((id) => !haveIds.has(id));

        if (ancestorIds.length > 0) {
            ancestors = db.select().from(messages)
                .where(and(
                    eq(messages.conversationId, conversationId),
                    inArray(messages.id, ancestorIds),
                ))
                .all();
        }
        for (const a of ancestors) haveIds.add(a.id);
    }

    // Also descend: for every loaded NON-ERRORED assistant, pull in
    // any `role:"tool"` rows that point back at it via parent_id. The
    // newest-first page window can stop mid-turn (e.g. only 20 of 31
    // tool results land in the page), which leaves the assistant's
    // tool_call parts unresolved on the FE and they render as
    // "running" forever. Tool rows have no children so this is a
    // single non-recursive pass.
    //
    // Errored assistants are excluded because their tool children are
    // orphans by definition (the assistant didn't finish committing the
    // tool_calls protocol). They're cleaned up server-side at error
    // time; this filter is defense-in-depth for any pre-existing rows
    // that pre-date that cleanup.
    const assistantIds = [...rows, ...ancestors]
        .filter((r) => r.role === "assistant" && !r.error)
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

    // Merge, preserving the requested sort order with the same
    // (created_at, id) tiebreaker the SQL uses — otherwise
    // tied-timestamp rows could reorder across the SQL/JS boundary.
    // Each source already excludes anything in `haveIds`, so the
    // concatenation is duplicate-free by construction.
    const merged = [...rows, ...ancestors, ...descendants].sort((a, b) => {
        // Guard the timestamp rather than comparing it raw. A missing
        // `createdAt` makes every `<`/`>` false, so a whole class of
        // rows silently compares "equal" and the list degrades to id
        // order — which is exactly how the raw-SQL mapping bug above
        // surfaced as scrambled conversations instead of an error.
        const at = a.createdAt ?? "";
        const bt = b.createdAt ?? "";
        let cmp = at < bt ? -1 : at > bt ? 1 : 0;
        if (cmp === 0) cmp = a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
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
