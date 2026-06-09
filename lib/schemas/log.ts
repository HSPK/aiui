import { z } from "zod";

export const logStatusSchema = z.enum(["pending", "completed", "failed"]);

// ---- DTOs ----

export const logListItemDTOSchema = z.object({
    id: z.string(),
    user_id: z.string(),
    /** Human-readable username joined from the users table at query time. */
    username: z.string().nullable(),
    model_name: z.string(),
    capability: z.string().nullable(),
    input_summary: z.string().nullable(),
    status: logStatusSchema,
    /** Short text representation of the request prompt for the table view. */
    input: z.string(),
    output: z.string(),
    reason: z.string().nullable(),
    prompt_tokens: z.number().int().nullable().optional(),
    completion_tokens: z.number().int().nullable().optional(),
    total_tokens: z.number().int().nullable().optional(),
    /** ms from upstream fetch start to the first content byte (streaming only). */
    first_token_latency_ms: z.number().int().nullable().optional(),
    /** ms from upstream fetch start to response fully consumed (always). */
    total_latency_ms: z.number().int().nullable().optional(),
    created_at: z.string(),
    updated_at: z.string(),
    is_deleted: z.boolean(),
});

export const logDetailDTOSchema = logListItemDTOSchema.extend({
    /** Full request body as it was sent upstream — JSON value. */
    input: z.unknown(),
    generation_kwargs: z.record(z.string(), z.unknown()),
    generation: z.record(z.string(), z.unknown()).nullable(),
    conversation_id: z.string().optional(),
    message_id: z.string().optional(),
});

// ---- Inputs ----

export const logListQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    page_size: z.coerce.number().int().min(1).max(500).default(20),
    sort: z.string().default("-created_at"),
    user_id: z.string().trim().optional(),
    model_name: z.string().trim().optional(),
    capability: z.string().trim().optional(),
    status: logStatusSchema.optional(),
});

// ---- Derived types ----

export type LogStatus = z.infer<typeof logStatusSchema>;
export type LogListItemDTO = z.infer<typeof logListItemDTOSchema>;
export type LogDetailDTO = z.infer<typeof logDetailDTOSchema>;
export type LogListQuery = z.infer<typeof logListQuerySchema>;

/** FE-friendly query type: nullable to allow "cleared" filters. */
export type LogFilterParams = {
    page?: number;
    page_size?: number;
    sort?: string;
    user_id?: string | null;
    model_name?: string | null;
    capability?: string | null;
    status?: LogStatus | null;
};
