import "server-only";
import { defineRoute } from "@/lib/server/route";
import { mcpServerCreateSchema } from "@/lib/schemas/mcp";
import { createMcpServer, listMcpServers } from "@/lib/server/mcp";

export const GET = defineRoute({
    handler: () => listMcpServers(),
});

export const POST = defineRoute({
    auth: "admin",
    body: mcpServerCreateSchema,
    handler: ({ body }) => createMcpServer(body),
});
