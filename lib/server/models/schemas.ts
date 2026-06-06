import { z } from "zod";

export const modelCreateSchema = z.object({
    name: z.string().trim().min(1, "Model name is required"),
    provider_id: z.string().trim().min(1, "provider_id is required"),
    upstream_model_id: z.string().trim().min(1, "upstream_model_id is required"),
    type: z.string().trim().min(1).optional(),
    default_params: z.record(z.string(), z.unknown()).optional(),
    context_window: z.number().int().nullable().optional(),
    max_tokens: z.number().int().nullable().optional(),
    output_dimension: z.number().int().nullable().optional(),
    pricing: z.record(z.string(), z.unknown()).nullable().optional(),
    description: z.string().nullable().optional(),
    knowledge_date: z.string().nullable().optional(),
    timeout: z.number().int().positive().optional(),
    max_retries: z.number().int().min(0).optional(),
    http_proxy: z.record(z.string(), z.string()).nullable().optional(),
    enabled: z.boolean().optional(),
});

export const modelUpdateSchema = modelCreateSchema.partial();

export type ModelCreateInput = z.infer<typeof modelCreateSchema>;
export type ModelUpdateInput = z.infer<typeof modelUpdateSchema>;
