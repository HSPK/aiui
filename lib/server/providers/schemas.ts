import { z } from "zod";

export const providerTypeSchema = z.enum(["openai", "azure"]);

const httpProxySchema = z.record(z.string(), z.string()).nullable().optional();

export const providerCreateSchema = z.object({
    name: z.string().trim().min(1, "Provider name is required"),
    type: providerTypeSchema.optional(),
    base_url: z.string().trim().min(1, "base_url is required").url("base_url must be a URL"),
    api_version: z.string().trim().nullable().optional(),
    api_key: z.string().nullable().optional(),
    default_params: z.record(z.string(), z.unknown()).optional(),
    http_proxy: httpProxySchema,
    document_page: z.string().optional(),
    model_page: z.string().optional(),
    is_local: z.boolean().optional(),
    enabled: z.boolean().optional(),
});

export const providerUpdateSchema = providerCreateSchema.partial();

export type ProviderCreateInput = z.infer<typeof providerCreateSchema>;
export type ProviderUpdateInput = z.infer<typeof providerUpdateSchema>;
