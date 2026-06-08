import "server-only";
import type { McpServer } from "../db/schema";
import type { McpServerDTO } from "@/lib/schemas/mcp";

export function serializeMcpServer(s: McpServer): McpServerDTO {
    return {
        id: s.id,
        name: s.name,
        description: s.description,
        transport: s.transport,
        config: (s.config ?? {}) as Record<string, unknown>,
        enabled: !!s.enabled,
        created_at: s.createdAt,
        updated_at: s.updatedAt,
    };
}
