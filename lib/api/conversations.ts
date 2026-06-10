"use client";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { defineResource } from "./resource";
import { fetcher } from "./client";
import type { Paginated } from "@/lib/schemas/common";
import type { ConversationDTO, MessageDTO } from "@/lib/schemas/conversation";

const base = defineResource<
    ConversationDTO,
    never,
    { title: string; expected_title?: string },
    { page?: number; page_size?: number; sort?: string; keyword?: string },
    Paginated<ConversationDTO>
>({
    path: "/conversations",
    key: "conversations",
    paramsOf: (q) => ({
        page: q.page ?? 1,
        page_size: q.page_size ?? 20,
        sort: q.sort ?? "-updated_at",
        keyword: q.keyword,
    }),
    // List + get are read-mostly; users rarely care about millisecond
    // freshness here. 60s lets nav back to the sidebar / chat skip
    // a network round-trip — mutations explicit-invalidate anyway.
    staleTime: 60_000,
});

/** Cache key for the initial page of messages of a single conversation.
 *  Lives under the conversation resource so it gets gc'd if the resource
 *  is gc'd, but is isolated from list/infinite queries so we can invalidate
 *  list-only without dropping the message cache. */
export function messagesCacheKey(conversationId: string, pageSize: number) {
    return [...base.keys.one(conversationId), "messages-cache", pageSize] as const;
}

export const conversations = {
    ...base,

    /** Title-only PATCH. When `expectedTitle` is supplied, the server
     *  performs a compare-and-swap: write only if the row's current
     *  title still equals `expectedTitle` — otherwise no-op. Background
     *  title generators MUST pass this so a manual rename that landed
     *  between snapshot-time and the LLM result isn't silently
     *  clobbered. */
    updateTitle: (id: string, title: string, expectedTitle?: string) =>
        base.update(id, expectedTitle === undefined ? { title } : { title, expected_title: expectedTitle }),

    // ---- shared message cache key (used by usePaginatedMessages / sync) ----
    messagesCacheKey,

    /** Invalidate only the conversation LIST queries (list/infinite),
     *  leaving the per-conversation messages cache intact. */
    useInvalidateList: () => {
        const qc = useQueryClient();
        return () => qc.invalidateQueries({
            queryKey: base.keys.all(),
            predicate: (q) => {
                const k = q.queryKey as readonly unknown[];
                return k.length >= 2 && (k[1] === "list" || k[1] === "infinite");
            },
        });
    },

    // ---- infinite scroll variant of useList ----
    useInfinite: (params?: { pageSize?: number; scope?: string; keyword?: string }) => {
        const pageSize = params?.pageSize ?? 20;
        const keyword = params?.keyword?.trim() || undefined;
        return useInfiniteQuery({
            queryKey: [
                ...base.keys.all(),
                "infinite",
                params?.scope ?? "default",
                pageSize,
                keyword ?? "",
            ] as const,
            initialPageParam: 1,
            queryFn: ({ pageParam = 1 }) =>
                base.list({ page: pageParam as number, page_size: pageSize, keyword }),
            getNextPageParam: (lastPage) => {
                if (!lastPage) return undefined;
                const hasMore = lastPage.page * lastPage.page_size < lastPage.total;
                return hasMore ? lastPage.page + 1 : undefined;
            },
        });
    },

    // ---- nested: messages under a conversation ----
    listMessages: (id: string, params?: { page?: number; page_size?: number; sort?: string }) =>
        fetcher<Paginated<MessageDTO>>(
            `/conversations/${encodeURIComponent(id)}/messages?` +
            new URLSearchParams({
                page: String(params?.page ?? 1),
                page_size: String(params?.page_size ?? 50),
                sort: params?.sort ?? "-created_at",
            }).toString(),
        ),
};

// Messages are a sibling resource only used for rating today.
const messagesKey = ["messages"] as const;
export const messages = {
    keys: { all: () => messagesKey },
    rate: (messageId: string, rating: "up" | "down" | "none", feedback?: string) =>
        fetcher<null>(`/messages/${encodeURIComponent(messageId)}/rate`, {
            method: "POST",
            body: JSON.stringify({ rating, feedback }),
        }),
};
