import "server-only";
import { and, asc, count, desc, eq, like, or, type SQL } from "drizzle-orm";
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
        filters.push(or(
            like(conversations.title, `%${query.keyword}%`),
            like(conversations.searchText, `%${query.keyword}%`),
        )!);
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
        search_text: c.searchText ?? undefined,
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

    const items: MessageDTO[] = rows.map((m) => ({
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
    return { items, total, page: query.page, page_size: query.page_size };
}
