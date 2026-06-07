import { z } from "zod";

/** Per-day usage row for trend charts. `day` is YYYY-MM-DD UTC. */
export const statsTrendPointSchema = z.object({
    day: z.string(),
    requests: z.number().int(),
    prompt_tokens: z.number().int(),
    completion_tokens: z.number().int(),
    total_tokens: z.number().int(),
    failed: z.number().int(),
});

export const statsBucketSchema = z.object({
    key: z.string(),
    label: z.string(),
    requests: z.number().int(),
    total_tokens: z.number().int(),
});

/** One row per (day, model) — long format. Consumers pivot into a
 *  stacked Bar chart by `model`. Anything not in `trend_models` is
 *  aggregated into the synthetic `_other` model. */
export const statsModelTrendPointSchema = z.object({
    day: z.string(),
    model: z.string(),
    requests: z.number().int(),
});

export const statsOverviewSchema = z.object({
    /** Inclusive — first day of the window, YYYY-MM-DD. */
    window_start: z.string(),
    /** Inclusive — last day of the window, YYYY-MM-DD. */
    window_end: z.string(),
    /** How many days `trend` covers (matches window length). */
    days: z.number().int().positive(),
    totals: z.object({
        requests: z.number().int(),
        completed: z.number().int(),
        failed: z.number().int(),
        pending: z.number().int(),
        prompt_tokens: z.number().int(),
        completion_tokens: z.number().int(),
        total_tokens: z.number().int(),
        /** Average TTFT (first_token_latency_ms) over completed, streaming requests. */
        avg_first_token_latency_ms: z.number().nullable(),
        /** Average end-to-end latency over completed requests. */
        avg_total_latency_ms: z.number().nullable(),
    }),
    trend: z.array(statsTrendPointSchema),
    /** Same window as `trend`, but split by model. Render as stacked bars. */
    trend_by_model: z.array(statsModelTrendPointSchema),
    /** Ordered top-N model keys present in trend_by_model, plus a final
     *  `_other` bucket if the catalog has more models than rendered. */
    trend_models: z.array(z.string()),
    by_capability: z.array(statsBucketSchema),
    by_model: z.array(statsBucketSchema),
});

/** Per-day metrics for one model — drives the per-model dashboard. */
export const statsModelTrendDetailSchema = z.object({
    day: z.string(),
    requests: z.number().int(),
    failed: z.number().int(),
    prompt_tokens: z.number().int(),
    completion_tokens: z.number().int(),
    total_tokens: z.number().int(),
    avg_first_token_latency_ms: z.number().nullable(),
    avg_total_latency_ms: z.number().nullable(),
});

export const modelStatsDTOSchema = z.object({
    model_name: z.string(),
    /** Resolved from the models table; null if the model has been deleted. */
    provider: z.string().nullable(),
    capability: z.string().nullable(),
    description: z.string().nullable(),
    context_window: z.number().int().nullable(),
    max_tokens: z.number().int().nullable(),
    /** Window — same shape as the overview. */
    window_start: z.string(),
    window_end: z.string(),
    days: z.number().int().positive(),
    totals: z.object({
        requests: z.number().int(),
        completed: z.number().int(),
        failed: z.number().int(),
        pending: z.number().int(),
        prompt_tokens: z.number().int(),
        completion_tokens: z.number().int(),
        total_tokens: z.number().int(),
        avg_first_token_latency_ms: z.number().nullable(),
        avg_total_latency_ms: z.number().nullable(),
    }),
    trend: z.array(statsModelTrendDetailSchema),
});

export const statsQuerySchema = z.object({
    /** Window in days. Default 14. */
    days: z.coerce.number().int().min(1).max(90).default(14),
    /** Admin-only: limit to a single user. Users always see their own. */
    user_id: z.string().trim().optional(),
});

export type StatsOverviewDTO = z.infer<typeof statsOverviewSchema>;
export type StatsTrendPoint = z.infer<typeof statsTrendPointSchema>;
export type StatsBucket = z.infer<typeof statsBucketSchema>;
export type StatsModelTrendPoint = z.infer<typeof statsModelTrendPointSchema>;
export type StatsModelTrendDetail = z.infer<typeof statsModelTrendDetailSchema>;
export type ModelStatsDTO = z.infer<typeof modelStatsDTOSchema>;
export type StatsQuery = z.infer<typeof statsQuerySchema>;

