import "server-only";
import { defineRoute } from "@/lib/server/route";
import { toolCreateSchema } from "@/lib/schemas/tool";
import { createTool, listTools } from "@/lib/server/tools";

export const GET = defineRoute({
    handler: () => listTools(),
});

export const POST = defineRoute({
    auth: "admin",
    body: toolCreateSchema,
    handler: ({ body }) => createTool(body),
});
