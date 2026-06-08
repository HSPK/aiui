import "server-only";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { mcpServers } from "../db/schema";
import { disposeMcpClient, listToolsForServer, readServerInfo } from "./runtime";
import type { McpServerDTO, McpToolDescriptor } from "@/lib/schemas/mcp";
import { serializeMcpServer } from "./serializer";

/**
 * Probe an MCP server: spawn / connect transport, run initialize +
 * tools/list, persist {status, error, tools_cache}, return the updated
 * DTO. Always swallows the underlying error and writes it to
 * `last_check_error` so the caller can surface health to the FE
 * without try/catching the whole world.
 *
 * Lives outside `service.ts` so the runtime (which imports the
 * service for listMcpServers) doesn't cycle back through CRUD code.
 */
export async function checkMcpServer(serverId: string): Promise<McpServerDTO | null> {
    const row = db.select().from(mcpServers).where(eq(mcpServers.id, serverId)).get();
    if (!row) return null;
    const dto = serializeMcpServer(row);

    // Drop any cached client so the check spawns a fresh connection.
    // Without this, a stale cached client would mask config errors
    // until the IDLE_MS sweep evicted it.
    await disposeMcpClient(serverId);

    const now = new Date().toISOString();
    try {
        const tools = await listToolsForServer(dto);
        const snapshot: McpToolDescriptor[] = tools.map((t) => ({
            name: t.localName,
            description: t.description,
            parameters: t.parameters,
        }));
        // Capture the server-reported identity that the initialize
        // handshake established alongside tools/list. Keeps the
        // details sheet useful without forcing the admin to type it.
        const serverInfo = readServerInfo(serverId);
        db.update(mcpServers).set({
            lastCheckStatus: "ok",
            lastCheckAt: now,
            lastCheckError: null,
            toolsCache: snapshot,
            serverInfo,
            updatedAt: now,
        }).where(eq(mcpServers.id, serverId)).run();
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        db.update(mcpServers).set({
            lastCheckStatus: "error",
            lastCheckAt: now,
            lastCheckError: message.slice(0, 2000),
            // Preserve existing tools_cache — last-known-good is more
            // useful in the FE than nuking on a transient failure.
            updatedAt: now,
        }).where(eq(mcpServers.id, serverId)).run();
    }

    const updated = db.select().from(mcpServers).where(eq(mcpServers.id, serverId)).get();
    return updated ? serializeMcpServer(updated) : null;
}
