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
 *
 * Connect-phase timeout uses the user's `mcp_connect_timeout_seconds`
 * preference verbatim. Slow networks (mainland-China runners reaching
 * npm/PyPI mirrors, fresh `npx`/`uvx` cold cache) routinely need 60-
 * 120s, so a hard ceiling here silently overrides the user's setting
 * and surfaces as a confusing timeout. If a specific restart bumps up
 * against your reverse-proxy budget, use the SSE `/check` endpoint
 * instead — it streams keepalive bytes so the proxy never reaps the
 * connection mid-spawn.
 */
export const POST = defineRoute({
    auth: "admin",
    params: paramsSchema,
    handler: async ({ user, params }) => {
        const id = decodeURIComponent(params.id);
        const server = getMcpServer(id);
        // Tight ceiling on the DISPOSE phase only — we want the wedged
        // process killed promptly; if it has in-flight RPCs they get
        // "Connection closed" which is the intended UX for an admin-
        // requested kick. Connect-phase budget is the user pref so
        // slow-network admins aren't silently capped.
        const RESTART_DISPOSE_CEILING_MS = 10_000;
        await disposeMcpClient(server.id, { waitForCloseMs: RESTART_DISPOSE_CEILING_MS });
        const connectTimeoutMs = getPreferences(user.id).mcp_connect_timeout_seconds * 1000;
        const updated = await checkMcpServer(server.id, connectTimeoutMs);
        // Row may have been concurrently deleted while we were
        // mid-dispose — surface as 404 so the FE's restart mutation
        // gets a proper error path instead of choking on a null DTO
        // in its onSuccess handler.
        if (!updated) throw notFound("MCP server not found");
        return updated;
    },
});
