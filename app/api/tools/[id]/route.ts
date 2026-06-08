import "server-only";
import { z } from "zod";
import { defineRoute } from "@/lib/server/route";
import { toolUpdateSchema } from "@/lib/schemas/tool";
import { deleteTool, getTool, updateTool } from "@/lib/server/tools";

const paramsSchema = z.object({ id: z.string().min(1) });

export const GET = defineRoute({
    params: paramsSchema,
    handler: ({ params }) => getTool(decodeURIComponent(params.id)),
});

export const PATCH = defineRoute({
    auth: "admin",
    params: paramsSchema,
    body: toolUpdateSchema,
    handler: ({ params, body }) => updateTool(decodeURIComponent(params.id), body),
});

export const DELETE = defineRoute({
    auth: "admin",
    params: paramsSchema,
    handler: ({ params }) => {
        deleteTool(decodeURIComponent(params.id));
    },
});
