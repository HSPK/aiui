import { z } from "zod";

export const logStatusSchema = z.enum(["pending", "completed", "failed"]);

export const logListQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    page_size: z.coerce.number().int().min(1).max(500).default(20),
    sort: z.string().default("-created_at"),
    user_id: z.string().trim().optional(),
    model_name: z.string().trim().optional(),
    capability: z.string().trim().optional(),
    status: logStatusSchema.optional(),
});

export type LogListQuery = z.infer<typeof logListQuerySchema>;
