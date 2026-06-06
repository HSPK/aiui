import "server-only";
import { z } from "zod";
import { defineRoute } from "@/lib/server/route";
import { listMessages } from "@/lib/server/conversations";

const querySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    page_size: z.coerce.number().int().min(1).max(500).default(50),
    sort: z.string().default("-created_at"),
});

export const GET = defineRoute({
    params: z.object({ id: z.string().min(1) }),
    query: querySchema,
    handler: ({ user, params, query }) => listMessages(user.id, params.id, query),
});
