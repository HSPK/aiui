import "server-only";
import { z } from "zod";
import { defineRoute } from "@/lib/server/route";
import { getMcpServer } from "@/lib/server/mcp";
import { listToolsForServer } from "@/lib/server/mcp/runtime";

const paramsSchema = z.object({ id: z.string().min(1) });

export const GET = defineRoute({
    // Admin-only: this endpoint has a side effect — spawning the
    // configured `npx`/`uvx`/`bunx` child if no cached connection
    // exists. Letting a non-admin enumerate server ids and trigger
    // arbitrary spawns is a DoS vector (fd exhaustion + install
    // storm) even though no secrets are returned.
    auth: "admin",
    params: paramsSchema,
    handler: async ({ params }) => {
        const server = getMcpServer(decodeURIComponent(params.id));
        const tools = await listToolsForServer(server);
        return {
            server_id: server.id,
            server_name: server.name,
            tools: tools.map((t) => ({
                qualified_name: t.qualifiedName,
                name: t.localName,
                description: t.description,
                parameters: t.parameters,
            })),
        };
    },
});
