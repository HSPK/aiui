import "server-only";
import { z } from "zod";
import { defineRoute } from "@/lib/server/route";
import { notFound } from "@/lib/server/response";
import { checkMcpServer, runMcpCheck, type McpCheckEvent } from "@/lib/server/mcp/checks";
import { getMcpServer } from "@/lib/server/mcp";
import { getPreferences } from "@/lib/server/preferences";

const paramsSchema = z.object({ id: z.string().min(1) });

export const POST = defineRoute({
    auth: "admin",
    params: paramsSchema,
    handler: async ({ req, user, params }) => {
        const id = decodeURIComponent(params.id);
        // Resolve name → id so admins can hit the endpoint with either.
        const server = getMcpServer(id);

        // Per-user override for the connect handshake budget — admins
        // who routinely wait on slow `npx`/`uvx` installs widen it
        // from the system default (60 min) in their settings page.
        const connectTimeoutMs = getPreferences(user.id).mcp_connect_timeout_seconds * 1000;

        // SSE branch — admin's check UI streams stderr in real time so
        // slow `npx`/`uvx` installs aren't silent black boxes. Plain
        // JSON branch kept for scripts and back-compat.
        if (req.headers.get("accept")?.includes("text/event-stream")) {
            return streamCheck(server.id, connectTimeoutMs);
        }

        const updated = await checkMcpServer(server.id, connectTimeoutMs);
        if (!updated) throw notFound("MCP server not found");
        return updated;
    },
});

const SSE_ENCODER = new TextEncoder();

function streamCheck(serverId: string, connectTimeoutMs: number): Response {
    // Client-disconnect plumbing — when the browser closes the tab,
    // ReadableStream.cancel fires. We abort an inner controller that
    // runMcpCheck checks between phases, so DB writes and event
    // dispatches stop. The underlying spawn (if in flight) continues
    // to completion — singleflight semantics mean other consumers
    // may have joined and would be hurt by an abort, AND the cached
    // connection benefits the next caller. Trade-off documented.
    const abort = new AbortController();
    const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
            const send = (ev: McpCheckEvent) => {
                try {
                    controller.enqueue(
                        SSE_ENCODER.encode(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`),
                    );
                } catch { /* stream closed */ }
            };
            try {
                await runMcpCheck(serverId, send, { connectTimeoutMs, signal: abort.signal });
            } finally {
                try { controller.close(); } catch { /* already closed */ }
            }
        },
        cancel() {
            // Browser tab closed / connection dropped. Stop streaming
            // and let runMcpCheck wind down at the next phase
            // boundary. We don't await runMcpCheck here because the
            // ReadableStream contract requires `cancel` to resolve
            // quickly.
            abort.abort();
        },
    });

    return new Response(stream, {
        status: 200,
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    });
}
