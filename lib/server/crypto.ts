import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

// AES-256-GCM for upstream provider API keys.
// Master key derived from LOOM_MASTER_KEY via SHA-256 to guarantee 32 bytes.

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

// SHA-256 of LOOM_MASTER_KEY — the derived AES key. LOOM_MASTER_KEY
// doesn't change at runtime, so we memoise the derivation. Without
// this every encrypt/decrypt re-hashes the master string.
let cachedKey: Buffer | null = null;

function getKey(): Buffer {
    if (cachedKey) return cachedKey;
    const raw = process.env.LOOM_MASTER_KEY;
    if (!raw) {
        throw new Error(
            "LOOM_MASTER_KEY environment variable is required to encrypt/decrypt provider API keys."
        );
    }
    cachedKey = createHash("sha256").update(raw).digest();
    return cachedKey;
}

export function encryptSecret(plain: string | null | undefined): string | null {
    if (!plain) return null;
    const key = getKey();
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decryptSecret(payload: string | null | undefined): string | null {
    if (!payload) return null;
    const key = getKey();
    const buf = Buffer.from(payload, "base64");
    if (buf.length < IV_LENGTH + TAG_LENGTH) {
        throw new Error("Encrypted payload too short");
    }
    const iv = buf.subarray(0, IV_LENGTH);
    const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const data = buf.subarray(IV_LENGTH + TAG_LENGTH);
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

export function sha256(input: string): string {
    return createHash("sha256").update(input).digest("hex");
}

export function constantTimeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
}

export function generateRandomToken(byteLength = 32): string {
    return randomBytes(byteLength).toString("base64url");
}
