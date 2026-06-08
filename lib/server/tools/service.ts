import "server-only";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { tools } from "../db/schema";
import { badRequest, notFound } from "../response";
import { serializeTool } from "./serializer";
import type { ToolCreateInput, ToolDTO, ToolUpdateInput } from "@/lib/schemas/tool";

function findByIdOrName(idOrName: string) {
    return (
        db.select().from(tools).where(eq(tools.id, idOrName)).get() ||
        db.select().from(tools).where(eq(tools.name, idOrName)).get()
    );
}

export function listTools(): ToolDTO[] {
    return db.select().from(tools).orderBy(tools.name).all().map(serializeTool);
}

export function getTool(idOrName: string): ToolDTO {
    const t = findByIdOrName(idOrName);
    if (!t) throw notFound("Tool not found");
    return serializeTool(t);
}

export function createTool(input: ToolCreateInput): ToolDTO {
    const name = input.name.trim();
    const dup = db.select().from(tools).where(eq(tools.name, name)).get();
    if (dup) throw badRequest("Tool name already exists");

    const id = randomUUID();
    db.insert(tools).values({
        id,
        name,
        description: input.description ?? "",
        parameters: input.parameters ?? {},
        webhookUrl: input.webhook_url?.trim() || null,
        enabled: input.enabled ?? true,
    }).run();
    return getTool(id);
}

export function updateTool(idOrName: string, input: ToolUpdateInput): ToolDTO {
    const t = findByIdOrName(idOrName);
    if (!t) throw notFound("Tool not found");

    const updates: Partial<typeof tools.$inferInsert> = {};
    if (input.name !== undefined) {
        const newName = input.name.trim();
        if (!newName) throw badRequest("Tool name cannot be empty");
        if (newName !== t.name) {
            const dup = db.select().from(tools).where(eq(tools.name, newName)).get();
            if (dup) throw badRequest("Tool name already exists");
            updates.name = newName;
        }
    }
    if (input.description !== undefined) updates.description = input.description;
    if (input.parameters !== undefined) updates.parameters = input.parameters ?? {};
    if (input.webhook_url !== undefined) updates.webhookUrl = input.webhook_url?.trim() || null;
    if (input.enabled !== undefined) updates.enabled = !!input.enabled;
    updates.updatedAt = new Date().toISOString();

    db.update(tools).set(updates).where(eq(tools.id, t.id)).run();
    return getTool(t.id);
}

export function deleteTool(idOrName: string): void {
    const t = findByIdOrName(idOrName);
    if (!t) throw notFound("Tool not found");
    db.delete(tools).where(eq(tools.id, t.id)).run();
}
