import "server-only";
import { z } from "zod";
import { defineRoute } from "@/lib/server/route";
import { notFound } from "@/lib/server/response";
import { checkMcpServer } from "@/lib/server/mcp/checks";
import { getMcpServer } from "@/lib/server/mcp";

const paramsSchema = z.object({ id: z.string().min(1) });

export const POST = defineRoute({
    auth: "admin",
    params: paramsSchema,
    handler: async ({ params }) => {
        const id = decodeURIComponent(params.id);
        // Resolve name → id so admins can hit the endpoint with either.
        const server = getMcpServer(id);
        const updated = await checkMcpServer(server.id);
        if (!updated) throw notFound("MCP server not found");
        return updated;
    },
});
