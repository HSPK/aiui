import "server-only";
import { z } from "zod";
import { defineRoute } from "@/lib/server/route";
import { notFound } from "@/lib/server/response";
import { getMcpServer } from "@/lib/server/mcp";
import { checkMcpServer } from "@/lib/server/mcp/checks";
import { disposeMcpClient } from "@/lib/server/mcp/runtime";
import { getPreferences } from "@/lib/server/preferences";

const paramsSchema = z.object({ id: z.string().min(1) });

/**
 * Admin "kick it" — force a clean teardown and immediately re-validate.
 * Use case: a child process is wedged but technically still alive (so
 * the runtime state machine sees `connected` and won't rebuild on its
 * own). Re-check alone won't help because it reuses cached connections;
 * restart explicitly disposes first.
 *
 * The check runs the standard tools/list + resources/list + prompts/list
 * pipeline and persists last_check_status — admin gets the same DTO
 * shape as `POST /check`, just with the fresh-spawn guarantee.
 */
export const POST = defineRoute({
    auth: "admin",
    params: paramsSchema,
    handler: async ({ user, params }) => {
        const id = decodeURIComponent(params.id);
        const server = getMcpServer(id);
        // Tight ceilings for BOTH phases (dispose + connect) so the
        // worst-case route latency stays well under common reverse-
        // proxy timeouts (nginx/ALB 60 s, CloudFlare free 100 s). The
        // admin explicitly asked to kick a wedged server — in-flight
        // RPCs hit "Connection closed", which is the intended UX. For
        // long cold spawns the admin uses SSE `/check` (no proxy
        // budget pressure) + `/runtime` poll for live progress.
        const RESTART_DISPOSE_CEILING_MS = 10_000;
        const RESTART_CONNECT_CEILING_MS = 30_000;
        await disposeMcpClient(server.id, { waitForCloseMs: RESTART_DISPOSE_CEILING_MS });
        const prefMs = getPreferences(user.id).mcp_connect_timeout_seconds * 1000;
        const connectTimeoutMs = Math.min(prefMs, RESTART_CONNECT_CEILING_MS);
        const updated = await checkMcpServer(server.id, connectTimeoutMs);
        // Row may have been concurrently deleted while we were
        // mid-dispose — surface as 404 so the FE's restart mutation
        // gets a proper error path instead of choking on a null DTO
        // in its onSuccess handler.
        if (!updated) throw notFound("MCP server not found");
        return updated;
    },
});
