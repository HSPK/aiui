import "server-only";
import { z } from "zod";
import { defineRoute } from "@/lib/server/route";
import { getLog } from "@/lib/server/logs";

export const GET = defineRoute({
    params: z.object({ id: z.string().min(1) }),
    handler: ({ user, params }) => getLog(user, params.id),
});
