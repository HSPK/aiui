import { z } from "zod";

/**
 * Adapter contract — the single source of truth for how the gateway
 * talks to a specific flavour of upstream and how model metadata is
 * normalized for storage / UI.
 *
 * SCOPE: only OpenAI-API-shaped upstreams for now (Chat Completions,
 * Responses, Embeddings, …). The interface is intentionally open so
 * Anthropic / Bedrock / Vertex native protocols can be added later
 * without touching the gateway core.
 */

// ---- Upstream API ids (per-capability variants the adapter can route to) ----

export const upstreamApiIdSchema = z.enum([
    "chat.completions",   // POST /v1/chat/completions — OpenAI standard
    "responses",          // POST /v1/responses        — OpenAI Responses API
    "embeddings",         // POST /v1/embeddings
    "images.generations", // POST /v1/images/generations
    "audio.speech",       // POST /v1/audio/speech
    "audio.transcriptions", // POST /v1/audio/transcriptions
    "rerank",             // POST /v1/rerank (Cohere/Jina shape)
    "videos",             // POST /v1/videos (OpenAI Sora) — multipart, async polling
]);
export type UpstreamApiId = z.infer<typeof upstreamApiIdSchema>;

// ---- Capability flags (what a model can do, normalized) ----

export const modelCapabilitiesSchema = z.object({
    chat: z.boolean().optional(),
    embeddings: z.boolean().optional(),
    responses: z.boolean().optional(),
    tools: z.boolean().optional(),
    vision: z.boolean().optional(),
    audio_in: z.boolean().optional(),
    audio_out: z.boolean().optional(),
    json_schema: z.boolean().optional(),
    batch: z.boolean().optional(),
    reasoning: z.boolean().optional(),
});
export type ModelCapabilities = z.infer<typeof modelCapabilitiesSchema>;

// ---- The normalized projection adapters return ----

export const normalizedModelMetaSchema = z.object({
    /** Adapter-assigned id used by the gateway to address this model upstream. */
    upstream_id: z.string(),
    /** Display label (often same as upstream_id). */
    label: z.string().optional(),

    /** Ordered preference of upstream APIs this model can serve. Gateway
     *  picks the first one that matches the requested capability. */
    supported_apis: z.array(upstreamApiIdSchema).default([]),
    /** Boolean flags for fast filtering / UI badges. */
    capabilities: modelCapabilitiesSchema.default({}),

    /** Whitelist of request fields the upstream is known to accept.
     *  `undefined` ⇒ unknown ⇒ pass everything through (default trust).
     *  `[]` ⇒ unknown ⇒ pass everything through (treat empty as missing). */
    accepted_fields: z.array(z.string()).optional(),
    /** Explicit fields the upstream is known to reject. Takes priority over
     *  the gateway's auto-injections (e.g. stream_options for Foundry). */
    rejected_fields: z.array(z.string()).optional(),

    context_window: z.number().int().nullable().optional(),
    max_output_tokens: z.number().int().nullable().optional(),

    publisher: z.string().nullable().optional(),
    version: z.string().nullable().optional(),
    format: z.string().nullable().optional(),
    owned_by: z.string().nullable().optional(),

    rate_limits: z
        .object({
            requests: z.number().int().nullable().optional(),
            tokens: z.number().int().nullable().optional(),
            window_seconds: z.number().int().nullable().optional(),
        })
        .optional(),

    pricing: z
        .object({
            input: z.number().nullable().optional(),
            output: z.number().nullable().optional(),
            currency: z.string().optional(),
        })
        .optional(),

    /** Verbatim entry from the upstream /models endpoint — for the UI's
     *  raw-metadata panel and as the audit source the adapter projected from. */
    raw: z.unknown().optional(),
});
export type NormalizedModelMeta = z.infer<typeof normalizedModelMetaSchema>;

// ---- Adapter id ----

/** Free-form string so users can register custom adapters without a schema
 *  change. The set of currently-registered ids is exposed by GET /api/adapters. */
export const adapterIdSchema = z.string().trim().min(1);
export type AdapterId = z.infer<typeof adapterIdSchema>;

/** UI-friendly descriptor of a registered adapter — returned by GET /api/adapters. */
export const adapterDescriptorSchema = z.object({
    id: adapterIdSchema,
    label: z.string(),
    description: z.string().optional(),
});
export type AdapterDescriptor = z.infer<typeof adapterDescriptorSchema>;
