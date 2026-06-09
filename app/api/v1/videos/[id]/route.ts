import "server-only";
import { z } from "zod";
import { defineRoute } from "@/lib/server/route";
import { gatewayProxy } from "@/lib/server/gateway";

const paramsSchema = z.object({ id: z.string().min(1) });
const querySchema = z.object({
    /** Caller-facing model name — needed to resolve which provider owns this video. */
    model: z.string().min(1),
});

/**
 * GET /v1/videos/{id}?model={name}    → poll status
 * DELETE /v1/videos/{id}?model={name} → delete the job
 *
 * The `model` query param is a small concession compared to OpenAI
 * vanilla (where the SDK keeps a single base URL), but Loom dispatches
 * to multiple providers per user — we need a hint to route the
 * follow-up call to the right baseUrl + auth.
 */
export const GET = defineRoute({
    auth: "gateway",
    params: paramsSchema,
    query: querySchema,
    handler: async ({ user, params, query }) =>
        gatewayProxy({
            user,
            modelName: query.model,
            method: "GET",
            path: `/videos/${encodeURIComponent(params.id)}`,
        }),
});

export const DELETE = defineRoute({
    auth: "gateway",
    params: paramsSchema,
    query: querySchema,
    handler: async ({ user, params, query }) =>
        gatewayProxy({
            user,
            modelName: query.model,
            method: "DELETE",
            path: `/videos/${encodeURIComponent(params.id)}`,
        }),
});
