import "server-only";
import { z } from "zod";
import { defineRoute } from "@/lib/server/route";
import { getMcpServer } from "@/lib/server/mcp";
import { getMcpRuntimeStatus } from "@/lib/server/mcp/runtime";
import { readMcpLog } from "@/lib/server/mcp/logs";
import type { McpRuntimeStatusDTO } from "@/lib/schemas/mcp";

const paramsSchema = z.object({ id: z.string().min(1) });
const querySchema = z.object({
    // Cap on lines returned from the log tail — admin can override
    // when debugging a noisy server. Hard ceiling of 5000 so a
    // pathological request can't OOM the route handler.
    log_lines: z.coerce.number().int().min(0).max(5000).optional(),
});

export const GET = defineRoute({
    auth: "admin",
    params: paramsSchema,
    query: querySchema,
    handler: ({ params, query }) => {
        const id = decodeURIComponent(params.id);
        const server = getMcpServer(id);
        const snapshot = getMcpRuntimeStatus(server.id);
        const recent = readMcpLog(server.id, query.log_lines ?? 200);
        const dto: McpRuntimeStatusDTO = {
            server_id: snapshot.serverId,
            status: snapshot.status,
            pid: snapshot.pid,
            started_at: snapshot.startedAt,
            built_for: snapshot.builtFor,
            error: snapshot.error,
            recent_logs: recent,
        };
        return dto;
    },
});
