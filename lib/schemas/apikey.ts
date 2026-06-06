import { z } from "zod";

export const apiKeyDTOSchema = z.object({
    id: z.string(),
    name: z.string(),
    prefix: z.string(),
    last_used_at: z.string().nullable(),
    created_at: z.string(),
});

/** Returned only the moment a new key is created — `key` is never readable again. */
export const apiKeyCreatedDTOSchema = apiKeyDTOSchema.extend({
    key: z.string(),
});

export const apiKeyCreateSchema = z.object({
    name: z.string().trim().min(1, "API key name is required"),
});

export type ApiKeyDTO = z.infer<typeof apiKeyDTOSchema>;
export type ApiKeyCreatedDTO = z.infer<typeof apiKeyCreatedDTOSchema>;
export type ApiKeyCreateInput = z.infer<typeof apiKeyCreateSchema>;
