import "server-only";
import { decryptSecret, encryptSecret } from "../crypto";
import type { McpTransport } from "@/lib/schemas/mcp";

/**
 * On-disk AES-256-GCM encryption for MCP config secret-bearing
 * fields. Mirrors the providers.api_key_encrypted pattern: even
 * though MCP CRUD is admin-only, the DB row often carries upstream
 * secrets (GitHub tokens, API keys in env / Authorization headers)
 * that shouldn't sit at rest in plaintext. The master key derives
 * from AIUI_MASTER_KEY, identical to providers.
 *
 * Strategy:
 *   - `env` (stdio) and `headers` (http) VALUES are encrypted; their
 *     keys remain plaintext so the FE / details sheet can list them.
 *   - Encrypted values are prefixed with the sentinel `ENC_PREFIX` so
 *     `decryptConfig` can distinguish encrypted-at-rest values from
 *     plaintext values written by old migrations / external imports.
 *   - All other fields (command, args, url, cwd, args[*]) stay
 *     plaintext — they're rarely sensitive and being inspectable on
 *     the table / details sheet is part of the design.
 *
 * Round-trip:
 *   service.create / update → encryptConfig → DB
 *   serializer / runtime     → decryptConfig  → DTO
 *
 * Adding a new transport in the future: extend the union in
 * `encryptConfig` / `decryptConfig` and decide which fields to
 * encrypt. The runtime + serializer are the only call sites.
 */

const ENC_PREFIX = "enc:v1:";

function encStr(value: unknown): unknown {
    if (typeof value !== "string") return value;
    // Already encrypted (idempotent — admin saves an unchanged row).
    if (value.startsWith(ENC_PREFIX)) return value;
    const enc = encryptSecret(value);
    return enc ? `${ENC_PREFIX}${enc}` : value;
}

function decStr(value: unknown): unknown {
    if (typeof value !== "string") return value;
    if (!value.startsWith(ENC_PREFIX)) return value;
    try {
        return decryptSecret(value.slice(ENC_PREFIX.length)) ?? value;
    } catch {
        // A corrupt / wrong-key payload: surface the sentinel so the
        // admin sees it broke rather than silently sending garbage to
        // a child process. The check endpoint will fail with a clear
        // upstream error and the admin can re-enter the secret.
        return "<decrypt-failed>";
    }
}

function mapObject(
    obj: unknown,
    fn: (v: unknown) => unknown,
): Record<string, unknown> | unknown {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return obj;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        out[k] = fn(v);
    }
    return out;
}

export function encryptConfig(
    transport: McpTransport,
    config: Record<string, unknown>,
): Record<string, unknown> {
    if (transport === "stdio") {
        const env = mapObject(config.env, encStr);
        return { ...config, env };
    }
    const headers = mapObject(config.headers, encStr);
    return { ...config, headers };
}

export function decryptConfig(
    transport: McpTransport,
    config: Record<string, unknown>,
): Record<string, unknown> {
    if (transport === "stdio") {
        const env = mapObject(config.env, decStr);
        return { ...config, env };
    }
    const headers = mapObject(config.headers, decStr);
    return { ...config, headers };
}
