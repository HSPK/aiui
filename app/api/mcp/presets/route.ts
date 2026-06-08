import "server-only";
import { defineRoute } from "@/lib/server/route";
import { MCP_PRESETS } from "@/lib/server/mcp/presets";

export const GET = defineRoute({
    handler: () => MCP_PRESETS,
});
