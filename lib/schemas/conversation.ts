import { z } from "zod";

export const messageRoleSchema = z.enum(["user", "assistant", "system", "tool"]);

// ---- Conversation DTO ----

export const conversationDTOSchema = z.object({
    id: z.string(),
    user_id: z.string(),
    title: z.string(),
    config: z.record(z.string(), z.unknown()),
    group_id: z.string().optional(),
    search_text: z.string().optional(),
    created_at: z.string(),
    updated_at: z.string(),
    is_deleted: z.boolean(),
});

// ---- Message DTO ----

export const messageDTOSchema = z.object({
    id: z.string(),
    conversation_id: z.string(),
    role: messageRoleSchema,
    content: z.unknown(),
    reasoning_content: z.string().optional(),
    model_id: z.string().optional(),
    generation_id: z.string().optional(),
    parent_id: z.string().optional(),
    meta: z.record(z.string(), z.unknown()).optional(),
    is_active: z.boolean(),
    rating: z.enum(["up", "down"]).optional(),
    feedback: z.string().optional(),
    created_at: z.string(),
});

// ---- Inputs ----

export const conversationListQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    page_size: z.coerce.number().int().min(1).max(200).default(20),
    sort: z.string().default("-updated_at"),
    keyword: z.string().trim().optional(),
});

export const conversationTitleSchema = z.object({
    title: z.string().trim().min(1, "title is required").max(200),
});

export const messageListQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    page_size: z.coerce.number().int().min(1).max(500).default(50),
    sort: z.string().default("-created_at"),
});

export const messageRatingSchema = z.object({
    rating: z.enum(["up", "down", "none"]),
    feedback: z.string().nullable().optional(),
});

// ---- Derived types ----

export type MessageRole = z.infer<typeof messageRoleSchema>;
export type ConversationDTO = z.infer<typeof conversationDTOSchema>;
export type MessageDTO = z.infer<typeof messageDTOSchema>;
export type ConversationListQuery = z.infer<typeof conversationListQuerySchema>;
export type ConversationTitleInput = z.infer<typeof conversationTitleSchema>;
export type MessageListQuery = z.infer<typeof messageListQuerySchema>;
export type MessageRatingInput = z.infer<typeof messageRatingSchema>;
