import "server-only";
import { z } from "zod";
import { defineRoute } from "@/lib/server/route";
import { gatewayProxy } from "@/lib/server/gateway";

const paramsSchema = z.object({ id: z.string().min(1) });
const querySchema = z.object({
    model: z.string().min(1),
    /** OpenAI: "video" (default), "thumbnail", or "spritesheet". Forwarded verbatim. */
    variant: z.enum(["video", "thumbnail", "spritesheet"]).optional(),
});

/**
 * GET /v1/videos/{id}/content?model={name}&variant=video|thumbnail|spritesheet
 *
 * Binary download for a completed video job. Pass-through; the
 * upstream sets Content-Type appropriately (video/mp4, image/png, …).
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
            path: `/videos/${encodeURIComponent(params.id)}/content`,
            query: query.variant ? `variant=${encodeURIComponent(query.variant)}` : undefined,
        }),
});
