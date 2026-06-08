import "server-only";
import type { McpServer } from "../db/schema";
import type { McpServerDTO } from "@/lib/schemas/mcp";
import { decryptConfig } from "./config-crypto";

export function serializeMcpServer(s: McpServer): McpServerDTO {
    return {
        id: s.id,
        name: s.name,
        description: s.description,
        transport: s.transport,
        // Decrypt on the way out so the admin-facing DTO is always
        // plaintext (admin-only auth + secret-key redaction lives on
        // the FE detail sheet). DB at rest stays encrypted.
        config: decryptConfig(s.transport, (s.config ?? {}) as Record<string, unknown>),
        enabled: !!s.enabled,
        last_check_status: s.lastCheckStatus ?? null,
        last_check_at: s.lastCheckAt ?? null,
        last_check_error: s.lastCheckError ?? null,
        tools_cache: s.toolsCache ?? null,
        server_info: s.serverInfo ?? null,
        created_at: s.createdAt,
        updated_at: s.updatedAt,
    };
}
