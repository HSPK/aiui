import "server-only";
import type { McpServer } from "../db/schema";
import type { McpServerDTO } from "@/lib/schemas/mcp";
import { decryptConfig } from "./config-crypto";

export interface SerializeOpts {
    /** True for non-admin callers — config is replaced with `{}` so
     *  env / headers (which carry tokens, API keys, Authorization
     *  values) never reach the wire for a non-admin user. The DTO
     *  still carries name / transport / enabled / tools_cache /
     *  health snapshot so chat playgrounds can render available
     *  servers without privileged access. */
    redactSecrets?: boolean;
}

export function serializeMcpServer(s: McpServer, opts?: SerializeOpts): McpServerDTO {
    let config: Record<string, unknown>;
    let decryptionFailed = false;
    if (opts?.redactSecrets) {
        // Non-admin caller: skip decryption entirely. No way for them
        // to learn that decryption is broken anyway — that's an admin
        // concern surfaced via the admin-facing DTO.
        config = {};
    } else {
        const dec = decryptConfig(s.transport, (s.config ?? {}) as Record<string, unknown>);
        config = dec.config;
        decryptionFailed = dec.decryptFailed;
    }
    return {
        id: s.id,
        name: s.name,
        description: s.description,
        transport: s.transport,
        // Decrypt on the way out so the admin-facing DTO is always
        // plaintext (admin-only auth + secret-key redaction lives on
        // the FE detail sheet). DB at rest stays encrypted. The
        // `redactSecrets` opt lets the route layer downgrade the
        // projection to non-admin callers without changing the DTO
        // shape consumers depend on.
        config,
        config_decryption_failed: decryptionFailed,
        enabled: !!s.enabled,
        last_check_status: s.lastCheckStatus ?? null,
        last_check_at: s.lastCheckAt ?? null,
        last_check_error: s.lastCheckError ?? null,
        tools_cache: s.toolsCache ?? null,
        resources_cache: s.resourcesCache ?? null,
        prompts_cache: s.promptsCache ?? null,
        server_info: s.serverInfo ?? null,
        config_version: s.configVersion,
        created_at: s.createdAt,
        updated_at: s.updatedAt,
    };
}
