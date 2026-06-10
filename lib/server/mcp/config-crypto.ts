import "server-only";
import { decryptSecret, encryptSecret } from "../crypto";
import type { McpTransport } from "@/lib/schemas/mcp";

/**
 * On-disk AES-256-GCM encryption for MCP config secret-bearing
 * fields. Mirrors the providers.api_key_encrypted pattern: even
 * though MCP CRUD is admin-only, the DB row often carries upstream
 * secrets (GitHub tokens, API keys in env / Authorization headers)
 * that shouldn't sit at rest in plaintext. The master key derives
 * from LOOM_MASTER_KEY, identical to providers.
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

/** Thrown by `decStr` when the ciphertext cannot be decrypted — the
 *  master key has changed, the row was hand-edited, or the payload was
 *  truncated. `decryptConfig` catches per-field so a single corrupted
 *  env var doesn't blow up the whole DTO; the field is replaced with
 *  an empty string and the per-config `decryptFailed` flag is raised.
 *  The serializer surfaces the flag as `decryption_failed` on the DTO
 *  so the admin form can refuse to save (otherwise the form would
 *  re-encrypt the empty string and silently overwrite the real
 *  ciphertext on the next save). */
export class DecryptionFailedError extends Error {
    constructor() {
        super("MCP secret decryption failed — master key may have changed or the ciphertext is corrupt");
        this.name = "DecryptionFailedError";
    }
}

function decStr(value: unknown): unknown {
    if (typeof value !== "string") return value;
    if (!value.startsWith(ENC_PREFIX)) return value;
    try {
        const result = decryptSecret(value.slice(ENC_PREFIX.length));
        if (result === undefined || result === null) throw new DecryptionFailedError();
        return result;
    } catch (err) {
        if (err instanceof DecryptionFailedError) throw err;
        throw new DecryptionFailedError();
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

/** Decrypt the secret-bearing fields. Returns `{ config, decryptFailed }`
 *  — `decryptFailed=true` means at least one ciphertext field couldn't be
 *  recovered (master key changed, corrupt payload). The failing fields
 *  are replaced with empty strings so the DTO shape is preserved; the
 *  caller (serializer → DTO → form) is expected to surface the flag and
 *  block the user from saving the cleared state back. Without this
 *  signalling, a re-save would re-encrypt the empty string and PERMANENTLY
 *  destroy the original ciphertext. */
export function decryptConfig(
    transport: McpTransport,
    config: Record<string, unknown>,
): { config: Record<string, unknown>; decryptFailed: boolean } {
    let decryptFailed = false;
    const safeDec = (v: unknown): unknown => {
        try { return decStr(v); }
        catch (err) {
            if (err instanceof DecryptionFailedError) { decryptFailed = true; return ""; }
            throw err;
        }
    };
    if (transport === "stdio") {
        const env = mapObject(config.env, safeDec);
        return { config: { ...config, env }, decryptFailed };
    }
    const headers = mapObject(config.headers, safeDec);
    return { config: { ...config, headers }, decryptFailed };
}
