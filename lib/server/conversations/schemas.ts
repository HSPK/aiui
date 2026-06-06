import { z } from "zod";

export const conversationListQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    page_size: z.coerce.number().int().min(1).max(200).default(20),
    sort: z.string().default("-updated_at"),
    keyword: z.string().trim().optional(),
});

export const conversationTitleSchema = z.object({
    title: z.string().trim().min(1, "title is required").max(200),
});

export type ConversationListQuery = z.infer<typeof conversationListQuerySchema>;
export type ConversationTitleInput = z.infer<typeof conversationTitleSchema>;
