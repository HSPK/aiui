// lib/server/crypto.ts — AES-256-GCM secret encryption, sha256, constant-time
// compare, random token generation.
//
// NOTE: `getKey()` memoises the derived AES key in a module-level
// `cachedKey`. Tests that need a *different* LOOM_MASTER_KEY must
// `vi.resetModules()` and dynamically `import()` a fresh module instance —
// mutating `process.env.LOOM_MASTER_KEY` alone has no effect on an
// already-loaded instance (that's exactly what one of the tests below
// verifies).
import { afterEach, describe, expect, it, vi } from "vitest";
import { constantTimeEqual, decryptSecret, encryptSecret, generateRandomToken, sha256 } from "@/lib/server/crypto";

describe("crypto: encryptSecret / decryptSecret", () => {
    it("round-trips a plaintext string", () => {
        const cipher = encryptSecret("sk-super-secret-value");
        expect(cipher).toBeTruthy();
        expect(cipher).not.toBe("sk-super-secret-value");
        expect(decryptSecret(cipher)).toBe("sk-super-secret-value");
    });

    it("produces a different ciphertext each call thanks to a random IV, but both decrypt to the same plaintext", () => {
        const a = encryptSecret("same-plaintext")!;
        const b = encryptSecret("same-plaintext")!;
        expect(a).not.toBe(b);
        expect(decryptSecret(a)).toBe("same-plaintext");
        expect(decryptSecret(b)).toBe("same-plaintext");
    });

    it("treats null, undefined and empty string as 'nothing to encrypt'", () => {
        expect(encryptSecret(null)).toBeNull();
        expect(encryptSecret(undefined)).toBeNull();
        expect(encryptSecret("")).toBeNull();
    });

    it("treats null, undefined and empty string as 'nothing to decrypt'", () => {
        expect(decryptSecret(null)).toBeNull();
        expect(decryptSecret(undefined)).toBeNull();
        expect(decryptSecret("")).toBeNull();
    });

    it("throws 'Encrypted payload too short' when the base64 payload can't hold IV+TAG", () => {
        // IV_LENGTH (12) + TAG_LENGTH (16) = 28 bytes minimum.
        const shortPayload = Buffer.alloc(10).toString("base64");
        expect(() => decryptSecret(shortPayload)).toThrow("Encrypted payload too short");
    });

    it("throws 'Encrypted payload too short' for an empty-but-non-empty-string-check-passing payload just under the boundary", () => {
        const boundaryPayload = Buffer.alloc(27).toString("base64"); // one byte short of 28
        expect(() => decryptSecret(boundaryPayload)).toThrow("Encrypted payload too short");
    });

    it("rejects tampered ciphertext via the GCM auth tag", () => {
        const cipher = encryptSecret("tamper-me-please")!;
        const buf = Buffer.from(cipher, "base64");
        // Flip the last byte of the encrypted data section (after IV+TAG) —
        // GCM's auth tag must fail to verify against the mutated ciphertext.
        buf[buf.length - 1] ^= 0xff;
        const tampered = buf.toString("base64");
        expect(() => decryptSecret(tampered)).toThrow();
    });

    it("rejects a payload whose auth tag was tampered with directly", () => {
        const cipher = encryptSecret("another-secret")!;
        const buf = Buffer.from(cipher, "base64");
        // Byte 12 is inside the 16-byte tag region (IV is bytes 0-11).
        buf[12] ^= 0xff;
        const tampered = buf.toString("base64");
        expect(() => decryptSecret(tampered)).toThrow();
    });
});

describe("crypto: sha256", () => {
    it("matches the well-known digest of the empty string", () => {
        expect(sha256("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    });

    it("is deterministic for the same input", () => {
        expect(sha256("hello world")).toBe(sha256("hello world"));
    });

    it("produces a 64-char lowercase hex string", () => {
        const digest = sha256("some-token-value");
        expect(digest).toMatch(/^[0-9a-f]{64}$/);
    });

    it("differs for different inputs", () => {
        expect(sha256("a")).not.toBe(sha256("b"));
    });
});

describe("crypto: constantTimeEqual", () => {
    it("returns true for identical strings", () => {
        expect(constantTimeEqual("abc123", "abc123")).toBe(true);
    });

    it("returns false for same-length but different content", () => {
        expect(constantTimeEqual("abc123", "abc124")).toBe(false);
    });

    it("returns false for different-length strings without throwing", () => {
        expect(constantTimeEqual("short", "a-lot-longer-string")).toBe(false);
        expect(constantTimeEqual("a-lot-longer-string", "short")).toBe(false);
    });

    it("returns false when one side is empty", () => {
        expect(constantTimeEqual("", "nonempty")).toBe(false);
        expect(constantTimeEqual("nonempty", "")).toBe(false);
    });

    it("returns true when both sides are empty", () => {
        expect(constantTimeEqual("", "")).toBe(true);
    });
});

describe("crypto: generateRandomToken", () => {
    it("defaults to 32 bytes, encoded as base64url (43 chars, no padding)", () => {
        const token = generateRandomToken();
        expect(token.length).toBe(43);
        expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it("respects a custom byteLength", () => {
        const token = generateRandomToken(16);
        expect(token.length).toBe(22);
    });

    it("produces different tokens on each call", () => {
        expect(generateRandomToken()).not.toBe(generateRandomToken());
    });
});

describe("crypto: LOOM_MASTER_KEY handling (module-level cachedKey)", () => {
    const ORIGINAL_KEY = process.env.LOOM_MASTER_KEY;

    afterEach(() => {
        vi.resetModules();
        if (ORIGINAL_KEY === undefined) delete process.env.LOOM_MASTER_KEY;
        else process.env.LOOM_MASTER_KEY = ORIGINAL_KEY;
    });

    it("throws a descriptive error when LOOM_MASTER_KEY is unset at first use", async () => {
        vi.resetModules();
        delete process.env.LOOM_MASTER_KEY;
        const fresh = await import("@/lib/server/crypto");
        expect(() => fresh.encryptSecret("x")).toThrow(/LOOM_MASTER_KEY/);
    });

    it("derives distinct keys for distinct LOOM_MASTER_KEY values (ciphertext isn't portable across keys)", async () => {
        vi.resetModules();
        process.env.LOOM_MASTER_KEY = "key-one";
        const modOne = await import("@/lib/server/crypto");
        const cipher = modOne.encryptSecret("hello-world")!;

        vi.resetModules();
        process.env.LOOM_MASTER_KEY = "key-two";
        const modTwo = await import("@/lib/server/crypto");
        expect(() => modTwo.decryptSecret(cipher)).toThrow();
    });

    it("memoises the derived key: mutating LOOM_MASTER_KEY after first use does not affect an already-loaded module instance", async () => {
        vi.resetModules();
        process.env.LOOM_MASTER_KEY = "stable-key";
        const fresh = await import("@/lib/server/crypto");
        const cipher = fresh.encryptSecret("memo-check")!;

        // Mutate the env var without resetting modules — the module's
        // cachedKey should NOT pick this up.
        process.env.LOOM_MASTER_KEY = "changed-after-first-use";
        expect(fresh.decryptSecret(cipher)).toBe("memo-check");
    });
});
