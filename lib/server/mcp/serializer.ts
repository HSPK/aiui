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
        last_check_status: s.lastCheckStatus ?? null,
        last_check_at: s.lastCheckAt ?? null,
        last_check_error: s.lastCheckError ?? null,
        tools_cache: s.toolsCache ?? null,
        created_at: s.createdAt,
        updated_at: s.updatedAt,
    };
}
