import "server-only";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { mcpServers } from "../db/schema";
import {
    disposeMcpClient,
    listPromptsForServer,
    listResourcesForServer,
    listToolsForServer,
    readServerInfo,
} from "./runtime";
import type {
    McpServerDTO,
    McpPromptDescriptor,
    McpResourcesSnapshot,
    McpToolDescriptor,
} from "@/lib/schemas/mcp";
import { serializeMcpServer } from "./serializer";

/** Soft caps on persisted snapshot sizes. A pathological server that
 *  exposes thousands of tools / resources / prompts would otherwise
 *  bloat the JSON columns and slow the FE renderer. Anything beyond
 *  the cap is silently dropped with a single noise entry so admins
 *  see the truncation in the details sheet. */
const MAX_TOOLS = 500;
const MAX_RESOURCES = 1000;
const MAX_RESOURCE_TEMPLATES = 200;
const MAX_PROMPTS = 500;

function capArray<T>(items: T[], cap: number): T[] {
    return items.length > cap ? items.slice(0, cap) : items;
}

/**
 * Probe an MCP server: spawn / connect transport, run initialize +
 * tools/list (and resources/list + prompts/list when the server
 * advertises those capabilities), persist {status, error, identity,
 * snapshots}, return the updated DTO. Always swallows the underlying
 * error and writes it to `last_check_error` so the caller can surface
 * health to the FE without try/catching the whole world.
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
        // tools/list — load-bearing for chat, must succeed.
        const tools = await listToolsForServer(dto);
        const toolsSnapshot: McpToolDescriptor[] = capArray(
            tools.map((t) => ({
                name: t.localName,
                description: t.description,
                parameters: t.parameters,
            })),
            MAX_TOOLS,
        );

        // resources/list + prompts/list — best-effort. Servers may
        // advertise the capability but fail the call (or not advertise
        // at all). Either way we keep going; details sheet renders
        // the section only when there's something to show.
        let resourcesSnapshot: McpResourcesSnapshot | null = null;
        let promptsSnapshot: McpPromptDescriptor[] | null = null;
        try {
            const raw = await listResourcesForServer(dto);
            if (raw) {
                resourcesSnapshot = {
                    resources: capArray(raw.resources, MAX_RESOURCES),
                    templates: capArray(raw.templates, MAX_RESOURCE_TEMPLATES),
                };
            }
        } catch { /* leave null, surface via missing section */ }
        try {
            const raw = await listPromptsForServer(dto);
            if (raw) promptsSnapshot = capArray(raw, MAX_PROMPTS);
        } catch { /* leave null, surface via missing section */ }

        // Capture the server-reported identity that the initialize
        // handshake established alongside tools/list.
        const serverInfo = readServerInfo(serverId);

        db.update(mcpServers).set({
            lastCheckStatus: "ok",
            lastCheckAt: now,
            lastCheckError: null,
            toolsCache: toolsSnapshot,
            resourcesCache: resourcesSnapshot,
            promptsCache: promptsSnapshot,
            serverInfo,
            updatedAt: now,
        }).where(eq(mcpServers.id, serverId)).run();
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        db.update(mcpServers).set({
            lastCheckStatus: "error",
            lastCheckAt: now,
            // Wider cap so enriched stderr traces (the most useful
            // signal for stdio failures — ENOENT, missing binary,
            // bad arg) survive persistence.
            lastCheckError: message.slice(0, 4000),
            // Preserve existing tools/resources/prompts caches —
            // last-known-good is more useful in the FE than nuking
            // on a transient failure.
            updatedAt: now,
        }).where(eq(mcpServers.id, serverId)).run();
    }

    const updated = db.select().from(mcpServers).where(eq(mcpServers.id, serverId)).get();
    return updated ? serializeMcpServer(updated) : null;
}
