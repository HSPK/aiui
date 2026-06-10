import { z } from "zod";
import { normalizedModelMetaSchema } from "./adapter";

// ---- DTO ----

export const pricingSchema = z.record(z.string(), z.unknown());

export const modelDTOSchema = z.object({
    id: z.string(),
    name: z.string(),
    /** Upstream id used in the actual gateway call. */
    model_id: z.string().nullable(),
    /** Provider base_url, surfaced for display convenience. */
    proxy: z.string().nullable(),
    timeout: z.number().int(),
    max_retries: z.number().int(),
    default_params: z.record(z.string(), z.unknown()),
    /** Capability id (chat | embedding | image | audio.* | rerank | ...). */
    type: z.string(),
    /** Pinned upstream API variant id; null = gateway auto-selects via
     *  capability.variantPreference + meta.supported_apis. */
    api_variant_id: z.string().nullable(),
    /** The variant id the gateway would currently dispatch to for this
     *  model — equals `api_variant_id` when pinned, otherwise the result
     *  of the capability preference walk. Always set when the capability
     *  + at least one variant resolves. Read-only; the form seeds its
     *  dropdown from this so the user sees what's effectively in use. */
    resolved_variant_id: z.string().nullable(),
    pricing: pricingSchema.nullable(),
    output_dimension: z.number().int().nullable(),
    context_window: z.number().int().nullable(),
    max_tokens: z.number().int().nullable(),
    description: z.string().nullable(),
    knowledge_date: z.string().nullable(),
    provider: z.string().nullable(),
    provider_id: z.string(),
    is_local: z.boolean(),
    enabled: z.boolean(),
    is_discovered: z.boolean().optional(),
    /** Adapter-projected metadata (supported_apis, capabilities,
     *  accepted_fields, rate_limits, …). `meta.raw` carries the verbatim
     *  upstream `/models` entry. Drives gateway routing decisions and the
     *  model details UI panels. */
    meta: normalizedModelMetaSchema.nullable().optional(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
});

// ---- Inputs ----

export const modelCreateSchema = z.object({
    name: z.string().trim().min(1, "Model name is required"),
    provider_id: z.string().trim().min(1, "provider_id is required"),
    upstream_model_id: z.string().trim().min(1, "upstream_model_id is required"),
    type: z.string().trim().min(1).optional(),
    /** Optional pinned variant id. Empty / null = auto. */
    api_variant_id: z.string().trim().nullable().optional(),
    default_params: z.record(z.string(), z.unknown()).optional(),
    context_window: z.number().int().nullable().optional(),
    max_tokens: z.number().int().nullable().optional(),
    output_dimension: z.number().int().nullable().optional(),
    pricing: pricingSchema.nullable().optional(),
    description: z.string().nullable().optional(),
    knowledge_date: z.string().nullable().optional(),
    timeout: z.number().int().positive().optional(),
    max_retries: z.number().int().min(0).optional(),
    enabled: z.boolean().optional(),
    /** Verbatim entry from the provider's `/models` endpoint at the time of
     *  override creation. Persisted so re-projection via the adapter works
     *  even when the discovery cache is cold. Typically populated by the
     *  admin UI when promoting a discovered model into a DB-backed
     *  override. */
    discovered_metadata: z.unknown().optional(),
});

export const modelUpdateSchema = modelCreateSchema.partial();

// ---- Derived types ----

export type Pricing = z.infer<typeof pricingSchema>;
export type ModelDTO = z.infer<typeof modelDTOSchema>;
export type ModelCreateInput = z.infer<typeof modelCreateSchema>;
export type ModelUpdateInput = z.infer<typeof modelUpdateSchema>;
