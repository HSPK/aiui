"use client";
import { useQuery } from "@tanstack/react-query";
import { defineResource } from "./resource";
import { fetcher } from "./client";
import type { Paginated } from "@/lib/schemas/common";
import type { ConversationDTO, MessageDTO } from "@/lib/schemas/conversation";

const base = defineResource<
    ConversationDTO,
    never,
    { title: string },
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
});

export const conversations = {
    ...base,

    // ---- shorthand: title-only update ----
    updateTitle: (id: string, title: string) => base.update(id, { title }),

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

    useMessages: (id: string | null | undefined, params?: { page?: number; page_size?: number; sort?: string }) =>
        useQuery({
            queryKey: ["conversations", id ?? "", "messages", params] as const,
            queryFn: () => conversations.listMessages(id!, params),
            enabled: !!id,
        }),
};

// Messages are a sibling resource only used for rating today.
export const messages = {
    rate: (messageId: string, rating: "up" | "down" | "none", feedback?: string) =>
        fetcher<null>(`/messages/${encodeURIComponent(messageId)}/rate`, {
            method: "POST",
            body: JSON.stringify({ rating, feedback }),
        }),
};
