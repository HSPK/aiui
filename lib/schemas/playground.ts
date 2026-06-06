import { z } from "zod";

export const playgroundChatSchema = z.object({
    message: z.string().min(1, "`message` is required"),
    model: z.string().min(1, "`model` is required"),
    conversation_id: z.string().optional(),
    parent_message_id: z.string().nullable().optional(),
    user_message_id: z.string().optional(),
    system: z.string().optional(),
    temperature: z.number().optional(),
    max_tokens: z.number().int().optional(),
    top_p: z.number().optional(),
    frequency_penalty: z.number().optional(),
    presence_penalty: z.number().optional(),
    reasoning_effort: z.enum(["low", "medium", "high"]).optional(),
    history_limit: z.number().int().min(1).optional(),
    /** Legacy typo, kept for the existing client. */
    conv_histrory_limit: z.number().int().min(1).optional(),
    stream: z.boolean().optional(),
});

export type PlaygroundChatInput = z.infer<typeof playgroundChatSchema>;
