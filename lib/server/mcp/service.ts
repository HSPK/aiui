import "server-only";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { mcpServers } from "../db/schema";
import { badRequest, notFound } from "../response";
import { serializeMcpServer } from "./serializer";
import { checkMcpServer } from "./checks";
import { encryptConfig } from "./config-crypto";
import { disposeMcpClient } from "./runtime";
import type { McpServerCreateInput, McpServerDTO, McpServerUpdateInput } from "@/lib/schemas/mcp";

function findByIdOrName(idOrName: string) {
    return (
        db.select().from(mcpServers).where(eq(mcpServers.id, idOrName)).get() ||
        db.select().from(mcpServers).where(eq(mcpServers.name, idOrName)).get()
    );
}

/** Fire-and-forget validation. We deliberately don't await it from the
 *  CRUD response — the spawn can take seconds (npx cold cache, uv
 *  install, etc.) and we don't want the dialog to hang. The FE polls
 *  the resource for the updated `last_check_*` fields. */
function scheduleCheck(id: string): void {
    void checkMcpServer(id).catch(() => { /* persisted as error */ });
}

export function listMcpServers(): McpServerDTO[] {
    return db.select().from(mcpServers).orderBy(mcpServers.name).all().map(serializeMcpServer);
}

export function getMcpServer(idOrName: string): McpServerDTO {
    const s = findByIdOrName(idOrName);
    if (!s) throw notFound("MCP server not found");
    return serializeMcpServer(s);
}

export function createMcpServer(input: McpServerCreateInput): McpServerDTO {
    const name = input.name.trim();
    const dup = db.select().from(mcpServers).where(eq(mcpServers.name, name)).get();
    if (dup) throw badRequest("Server name already exists");

    const id = randomUUID();
    db.insert(mcpServers).values({
        id,
        name,
        description: input.description ?? "",
        transport: input.transport,
        config: encryptConfig(input.transport, input.config),
        enabled: input.enabled ?? true,
    }).run();
    scheduleCheck(id);
    return getMcpServer(id);
}

export function updateMcpServer(idOrName: string, input: McpServerUpdateInput): McpServerDTO {
    const s = findByIdOrName(idOrName);
    if (!s) throw notFound("MCP server not found");

    const updates: Partial<typeof mcpServers.$inferInsert> = {};
    let configChanged = false;
    if (input.name !== undefined) {
        const newName = input.name.trim();
        if (!newName) throw badRequest("Server name cannot be empty");
        if (newName !== s.name) {
            const dup = db.select().from(mcpServers).where(eq(mcpServers.name, newName)).get();
            if (dup) throw badRequest("Server name already exists");
            updates.name = newName;
        }
    }
    if (input.description !== undefined) updates.description = input.description;
    const finalTransport = input.transport ?? s.transport;
    if (input.transport !== undefined && input.transport !== s.transport) {
        updates.transport = input.transport;
        configChanged = true;
    }
    if (input.config !== undefined) {
        updates.config = encryptConfig(finalTransport, input.config);
        configChanged = true;
    }
    if (input.enabled !== undefined) updates.enabled = !!input.enabled;
    updates.updatedAt = new Date().toISOString();

    db.update(mcpServers).set(updates).where(eq(mcpServers.id, s.id)).run();
    if (configChanged) scheduleCheck(s.id);
    return getMcpServer(s.id);
}

export function deleteMcpServer(idOrName: string): void {
    const s = findByIdOrName(idOrName);
    if (!s) throw notFound("MCP server not found");
    db.delete(mcpServers).where(eq(mcpServers.id, s.id)).run();
    // Free the cached connection so we don't keep a child process
    // alive for the IDLE_MS sweep window after the row is gone.
    void disposeMcpClient(s.id).catch(() => { /* ignore */ });
}
