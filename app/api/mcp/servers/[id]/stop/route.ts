import "server-only";
import { z } from "zod";
import { defineRoute } from "@/lib/server/route";
import { getMcpServer } from "@/lib/server/mcp";
import { disposeMcpClient, getMcpRuntimeStatus } from "@/lib/server/mcp/runtime";
import { readMcpLog } from "@/lib/server/mcp/logs";
import type { McpRuntimeStatusDTO } from "@/lib/schemas/mcp";

const paramsSchema = z.object({ id: z.string().min(1) });

/**
 * Admin-initiated teardown. Closes the cached transport, kills the
 * stdio child, removes the runtime entry. The next consumer (chat
 * tool dispatch, re-check, restart) transparently rebuilds — no
 * status flip stops that. Distinct from disable: stop is one-shot
 * (transport may come back on next access) whereas disable persists
 * `enabled = false` to DB.
 */
export const POST = defineRoute({
    auth: "admin",
    params: paramsSchema,
    handler: async ({ params }) => {
        const id = decodeURIComponent(params.id);
        const server = getMcpServer(id);
        await disposeMcpClient(server.id);
        const snapshot = getMcpRuntimeStatus(server.id);
        const dto: McpRuntimeStatusDTO = {
            server_id: snapshot.serverId,
            status: snapshot.status,
            pid: snapshot.pid,
            started_at: snapshot.startedAt,
            built_for: snapshot.builtFor,
            error: snapshot.error,
            recent_logs: readMcpLog(server.id, 200),
        };
        return dto;
    },
});
