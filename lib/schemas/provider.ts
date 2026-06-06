import { z } from "zod";
import { adapterIdSchema } from "./adapter";

// ---- DTO ----

export const providerDTOSchema = z.object({
    id: z.string(),
    name: z.string(),
    /** Convenience alias of `name`, kept for FE compatibility. */
    provider_name: z.string(),
    /** Adapter id (from `lib/server/adapters/`) that handles transport
     *  + schema for this provider. Default `"openai"`. */
    adapter_id: adapterIdSchema,
    base_url: z.string(),
    /** Alias of `base_url`. */
    proxy: z.string(),
    api_version: z.string().nullable(),
    has_api_key: z.boolean(),
    default_params: z.record(z.string(), z.unknown()),
    http_proxy: z.record(z.string(), z.string()).nullable(),
    document_page: z.string(),
    model_page: z.string(),
    /** Optional full URL returning `{"status": "ok"}` when healthy. */
    health_check_url: z.string().nullable(),
    /** Result of the most recent health-check probe (only meaningful when
     *  `health_check_url` is set). */
    last_health_status: z.enum(["ok", "down"]).nullable(),
    last_health_checked_at: z.string().nullable(),
    last_health_error: z.string().nullable(),
    is_local: z.boolean(),
    enabled: z.boolean(),
    n_models: z.number().int().optional(),
    created_at: z.string(),
    updated_at: z.string(),
});

// ---- Inputs ----

export const providerCreateSchema = z.object({
    name: z.string().trim().min(1, "Provider name is required"),
    /** If omitted, the server auto-detects via the adapter registry's
     *  `matches()` pass over the configured base_url. */
    adapter_id: adapterIdSchema.optional(),
    base_url: z.string().trim().min(1, "base_url is required").url("base_url must be a URL"),
    api_version: z.string().trim().nullable().optional(),
    api_key: z.string().nullable().optional(),
    default_params: z.record(z.string(), z.unknown()).optional(),
    http_proxy: z.record(z.string(), z.string()).nullable().optional(),
    document_page: z.string().optional(),
    model_page: z.string().optional(),
    health_check_url: z
        .string()
        .trim()
        .url("health_check_url must be a URL")
        .nullable()
        .optional(),
    is_local: z.boolean().optional(),
    enabled: z.boolean().optional(),
});

export const providerUpdateSchema = providerCreateSchema.partial();

// ---- Derived types ----

export type ProviderDTO = z.infer<typeof providerDTOSchema>;
export type ProviderCreateInput = z.infer<typeof providerCreateSchema>;
export type ProviderUpdateInput = z.infer<typeof providerUpdateSchema>;
