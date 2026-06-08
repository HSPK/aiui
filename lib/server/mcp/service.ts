import "server-only";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { mcpServers } from "../db/schema";
import { badRequest, notFound } from "../response";
import { serializeMcpServer } from "./serializer";
import type { McpServerCreateInput, McpServerDTO, McpServerUpdateInput } from "@/lib/schemas/mcp";
function findByIdOrName(idOrName: string) {
    return (
        db.select().from(mcpServers).where(eq(mcpServers.id, idOrName)).get() ||
        db.select().from(mcpServers).where(eq(mcpServers.name, idOrName)).get()
    );
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
        config: input.config,
        enabled: input.enabled ?? true,
    }).run();
    return getMcpServer(id);
}

export function updateMcpServer(idOrName: string, input: McpServerUpdateInput): McpServerDTO {
    const s = findByIdOrName(idOrName);
    if (!s) throw notFound("MCP server not found");

    const updates: Partial<typeof mcpServers.$inferInsert> = {};
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
    if (input.transport !== undefined) updates.transport = input.transport;
    if (input.config !== undefined) updates.config = input.config;
    if (input.enabled !== undefined) updates.enabled = !!input.enabled;
    updates.updatedAt = new Date().toISOString();

    db.update(mcpServers).set(updates).where(eq(mcpServers.id, s.id)).run();
    return getMcpServer(s.id);
}

export function deleteMcpServer(idOrName: string): void {
    const s = findByIdOrName(idOrName);
    if (!s) throw notFound("MCP server not found");
    db.delete(mcpServers).where(eq(mcpServers.id, s.id)).run();
}
