import "server-only";
import { defineRoute } from "@/lib/server/route";
import { statsQuerySchema } from "@/lib/schemas/stats";
import { getOverview } from "@/lib/server/stats";

export const GET = defineRoute({
    query: statsQuerySchema,
    handler: ({ user, query }) => getOverview(user, query),
});
