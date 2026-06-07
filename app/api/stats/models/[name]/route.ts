import "server-only";
import { z } from "zod";
import { defineRoute } from "@/lib/server/route";
import { statsQuerySchema } from "@/lib/schemas/stats";
import { getModelStats } from "@/lib/server/stats";

const paramsSchema = z.object({ name: z.string().min(1) });

export const GET = defineRoute({
    params: paramsSchema,
    query: statsQuerySchema,
    handler: ({ user, params, query }) =>
        getModelStats(user, decodeURIComponent(params.name), query),
});
