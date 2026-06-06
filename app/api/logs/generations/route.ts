import "server-only";
import { defineRoute } from "@/lib/server/route";
import { logListQuerySchema } from "@/lib/schemas/log";
import { listLogs } from "@/lib/server/logs";

export const GET = defineRoute({
    query: logListQuerySchema,
    handler: ({ user, query }) => listLogs(user, query),
});
