import { fetcher, withQuery } from "./client";
import type {
    ConversationListResponse,
    MessageListResponse,
} from "@/lib/types/playground";

export const conversationsApi = {
    list: (page = 1, pageSize = 20, keyword?: string) =>
        fetcher<ConversationListResponse>(withQuery("/conversations", {
            page,
            page_size: pageSize,
            sort: "-updated_at",
            keyword,
        })),
    listMessages: (id: string, params?: { page?: number; page_size?: number; sort?: string }) =>
        fetcher<MessageListResponse>(withQuery(`/conversations/${encodeURIComponent(id)}/messages`, {
            page: params?.page ?? 1,
            page_size: params?.page_size ?? 50,
            sort: params?.sort ?? "-created_at",
        })),
    remove: (id: string) =>
        fetcher<null>(`/conversations/${encodeURIComponent(id)}`, { method: "DELETE" }),
    updateTitle: (id: string, title: string) =>
        fetcher<null>(`/conversations/${encodeURIComponent(id)}`, {
            method: "PATCH",
            body: JSON.stringify({ title }),
        }),
};

export const messagesApi = {
    rate: (messageId: string, rating: "up" | "down" | "none", feedback?: string) =>
        fetcher<null>(`/messages/${encodeURIComponent(messageId)}/rate`, {
            method: "POST",
            body: JSON.stringify({ rating, feedback }),
        }),
};
