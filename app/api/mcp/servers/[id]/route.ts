import "server-only";
import { z } from "zod";
import { defineRoute } from "@/lib/server/route";
import { mcpServerUpdateSchema } from "@/lib/schemas/mcp";
import { deleteMcpServer, getMcpServer, updateMcpServer } from "@/lib/server/mcp";

const paramsSchema = z.object({ id: z.string().min(1) });

export const GET = defineRoute({
    // Same projection rule as the list endpoint — non-admin users
    // get a redacted config so secrets in env / headers don't leak.
    params: paramsSchema,
    handler: ({ user, params }) =>
        getMcpServer(decodeURIComponent(params.id), { redactSecrets: user.role !== "admin" }),
});

export const PATCH = defineRoute({
    auth: "admin",
    params: paramsSchema,
    body: mcpServerUpdateSchema,
    handler: ({ params, body }) => updateMcpServer(decodeURIComponent(params.id), body),
});

export const DELETE = defineRoute({
    auth: "admin",
    params: paramsSchema,
    handler: ({ params }) => {
        deleteMcpServer(decodeURIComponent(params.id));
    },
});
