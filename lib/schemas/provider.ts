import { z } from "zod";

export const providerTypeSchema = z.enum(["openai", "azure"]);

// ---- DTO ----

export const providerDTOSchema = z.object({
    id: z.string(),
    name: z.string(),
    /** Convenience alias of `name`, kept for FE compatibility. */
    provider_name: z.string(),
    type: providerTypeSchema,
    base_url: z.string(),
    /** Alias of `base_url`. */
    proxy: z.string(),
    api_version: z.string().nullable(),
    has_api_key: z.boolean(),
    api_key_mask: z.string(),
    default_params: z.record(z.string(), z.unknown()),
    http_proxy: z.record(z.string(), z.string()).nullable(),
    document_page: z.string(),
    model_page: z.string(),
    is_local: z.boolean(),
    enabled: z.boolean(),
    n_models: z.number().int().optional(),
    created_at: z.string(),
    updated_at: z.string(),
});

// ---- Inputs ----

export const providerCreateSchema = z.object({
    name: z.string().trim().min(1, "Provider name is required"),
    type: providerTypeSchema.optional(),
    base_url: z.string().trim().min(1, "base_url is required").url("base_url must be a URL"),
    api_version: z.string().trim().nullable().optional(),
    api_key: z.string().nullable().optional(),
    default_params: z.record(z.string(), z.unknown()).optional(),
    http_proxy: z.record(z.string(), z.string()).nullable().optional(),
    document_page: z.string().optional(),
    model_page: z.string().optional(),
    is_local: z.boolean().optional(),
    enabled: z.boolean().optional(),
});

export const providerUpdateSchema = providerCreateSchema.partial();

// ---- Derived types ----

export type ProviderType = z.infer<typeof providerTypeSchema>;
export type ProviderDTO = z.infer<typeof providerDTOSchema>;
export type ProviderCreateInput = z.infer<typeof providerCreateSchema>;
export type ProviderUpdateInput = z.infer<typeof providerUpdateSchema>;
