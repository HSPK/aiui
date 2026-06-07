import { z } from "zod";

export const playgroundChatSchema = z.object({
    message: z.string().min(1, "`message` is required"),
    model: z.string().min(1, "`model` is required"),
    conversation_id: z.string().optional(),
    parent_message_id: z.string().nullable().optional(),
    user_message_id: z.string().optional(),
    /** Upsert key for retries — same id replaces, missing id creates new. */
    assistant_message_id: z.string().optional(),
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

// ---- Embedding pairwise comparison ----

export const playgroundEmbeddingParamsSchema = z.object({
    /** Some OpenAI-family models (text-embedding-3-*) support truncating
     *  the returned vector to this many dimensions. Forwarded as-is. */
    dimensions: z.number().int().positive().optional(),
    /** OpenAI: "float" | "base64". Default upstream. */
    encoding_format: z.enum(["float", "base64"]).optional(),
    /** Pass-through for providers that require it (Cohere, voyage…). */
    input_type: z.string().optional(),
    /** Free-form opaque user id for upstream attribution. */
    user: z.string().optional(),
});

export const playgroundEmbeddingSchema = z.object({
    /** At least one model. Each model is called once with
     *  `input=[query, ...documents]` (single upstream call per model). */
    models: z.array(z.string().min(1)).min(1, "Pick at least one model"),
    /** Single query line embedded once per model. */
    query: z.string().min(1, "`query` is required"),
    /** One document per line. Each is scored against the query via cosine. */
    documents: z.array(z.string().min(1)).min(1, "Need at least one document").max(64),
    params: playgroundEmbeddingParamsSchema.optional(),
});

export const playgroundEmbeddingDocScoreSchema = z.object({
    /** Index into the request's `documents` array (so the FE can keep
     *  original order if it wants, while sorting visible rows). */
    index: z.number().int(),
    score: z.number(),
});

export const playgroundEmbeddingModelResultSchema = z.object({
    model: z.string(),
    /** Vector for the query input. `null` on upstream error. */
    query_vector: z.array(z.number()).nullable(),
    /** Per-document vectors, parallel to the request's `documents`. */
    document_vectors: z.array(z.array(z.number()).nullable()),
    dim: z.number().int().nullable(),
    /** Cosine similarity query→each document, ordered by document index. */
    scores: z.array(playgroundEmbeddingDocScoreSchema).nullable(),
    prompt_tokens: z.number().int().nullable(),
    total_tokens: z.number().int().nullable(),
    elapsed_ms: z.number().int(),
    /** Set when the call failed; vector fields are null and scores null. */
    error: z.string().optional(),
});

export const playgroundEmbeddingResultSchema = z.object({
    query: z.string(),
    documents: z.array(z.string()),
    results: z.array(playgroundEmbeddingModelResultSchema),
});

export type PlaygroundEmbeddingParams = z.infer<typeof playgroundEmbeddingParamsSchema>;
export type PlaygroundEmbeddingInput = z.infer<typeof playgroundEmbeddingSchema>;
export type PlaygroundEmbeddingDocScore = z.infer<typeof playgroundEmbeddingDocScoreSchema>;
export type PlaygroundEmbeddingModelResult = z.infer<typeof playgroundEmbeddingModelResultSchema>;
export type PlaygroundEmbeddingResult = z.infer<typeof playgroundEmbeddingResultSchema>;
