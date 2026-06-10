import "server-only";
import { defineRoute } from "@/lib/server/route";
import { mcpServerCreateSchema } from "@/lib/schemas/mcp";
import { createMcpServer, listMcpServers } from "@/lib/server/mcp";
import { getPreferences } from "@/lib/server/preferences";

export const GET = defineRoute({
    // Authenticated users (e.g. chat playground showing available MCP
    // tools) can list servers, but non-admins get a redacted config
    // — env / headers carry secrets that must never leak.
    handler: ({ user }) => listMcpServers({ redactSecrets: user.role !== "admin" }),
});

export const POST = defineRoute({
    auth: "admin",
    body: mcpServerCreateSchema,
    handler: ({ user, body }) =>
        createMcpServer(body, {
            connectTimeoutMs: getPreferences(user.id).mcp_connect_timeout_seconds * 1000,
        }),
});
