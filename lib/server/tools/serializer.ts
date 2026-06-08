import "server-only";
import type { Tool } from "../db/schema";
import type { ToolDTO } from "@/lib/schemas/tool";

export function serializeTool(t: Tool): ToolDTO {
    return {
        id: t.id,
        name: t.name,
        description: t.description,
        parameters: (t.parameters ?? {}) as Record<string, unknown>,
        webhook_url: t.webhookUrl ?? null,
        enabled: !!t.enabled,
        created_at: t.createdAt,
        updated_at: t.updatedAt,
    };
}
