import { describe, expect, it } from "vitest";
import {
    DecryptionFailedError,
    decryptConfig,
    encryptConfig,
} from "@/lib/server/mcp/config-crypto";

const ENC_PREFIX = "enc:v1:";

describe("config-crypto", () => {
    describe("encryptConfig", () => {
        it("encrypts every value under stdio.env, leaving keys plaintext", () => {
            const out = encryptConfig("stdio", {
                command: "npx",
                args: ["-y", "@scope/server"],
                env: { GITHUB_TOKEN: "secret-value", OTHER: "another-secret" },
                cwd: "/repo",
            });
            const env = out.env as Record<string, string>;
            expect(Object.keys(env).sort()).toEqual(["GITHUB_TOKEN", "OTHER"]);
            expect(env.GITHUB_TOKEN).not.toBe("secret-value");
            expect(env.GITHUB_TOKEN.startsWith(ENC_PREFIX)).toBe(true);
            expect(env.OTHER.startsWith(ENC_PREFIX)).toBe(true);
            // Non-secret fields pass through untouched.
            expect(out.command).toBe("npx");
            expect(out.args).toEqual(["-y", "@scope/server"]);
            expect(out.cwd).toBe("/repo");
        });

        it("encrypts every value under http.headers, leaving keys plaintext", () => {
            const out = encryptConfig("http", {
                url: "https://example.com/mcp",
                headers: { Authorization: "Bearer tok", "X-Api-Key": "k1" },
            });
            const headers = out.headers as Record<string, string>;
            expect(headers.Authorization.startsWith(ENC_PREFIX)).toBe(true);
            expect(headers["X-Api-Key"].startsWith(ENC_PREFIX)).toBe(true);
            expect(out.url).toBe("https://example.com/mcp");
        });

        it("stdio transport never touches a headers field even if present", () => {
            // Hybrid/malformed input shouldn't happen in practice (zod gates
            // the shape), but encryptConfig only looks at `env` for stdio —
            // any stray `headers` blob must survive completely untouched.
            const out = encryptConfig("stdio", {
                command: "npx",
                env: { TOKEN: "secret" },
                headers: { Authorization: "leaked-plaintext" },
            });
            expect(out.headers).toEqual({ Authorization: "leaked-plaintext" });
        });

        it("http transport never touches an env field even if present", () => {
            const out = encryptConfig("http", {
                url: "https://example.com",
                headers: { Authorization: "secret" },
                env: { TOKEN: "leaked-plaintext" },
            });
            expect(out.env).toEqual({ TOKEN: "leaked-plaintext" });
        });

        it("handles a missing env/headers field without throwing", () => {
            expect(() => encryptConfig("stdio", { command: "npx" })).not.toThrow();
            const out = encryptConfig("stdio", { command: "npx" });
            expect(out.env).toBeUndefined();
        });

        it("handles an empty env/headers object", () => {
            const out = encryptConfig("stdio", { command: "npx", env: {} });
            expect(out.env).toEqual({});
        });

        it("is idempotent — re-encrypting an already-encrypted value doesn't double-wrap it", () => {
            const once = encryptConfig("stdio", { command: "npx", env: { TOKEN: "secret" } });
            const twice = encryptConfig("stdio", once);
            const envOnce = once.env as Record<string, string>;
            const envTwice = twice.env as Record<string, string>;
            // Same ciphertext, not `enc:v1:enc:v1:...`.
            expect(envTwice.TOKEN).toBe(envOnce.TOKEN);
            expect(envTwice.TOKEN.startsWith(`${ENC_PREFIX}${ENC_PREFIX}`)).toBe(false);
        });

        it("does not encrypt an empty-string secret (encryptSecret treats falsy as no-op)", () => {
            const out = encryptConfig("stdio", { command: "npx", env: { TOKEN: "" } });
            const env = out.env as Record<string, string>;
            // encryptSecret("") returns null because `!plain` is true for "" —
            // encStr's `enc ? ... : value` ternary falls back to the
            // original (empty) value instead of producing ciphertext.
            expect(env.TOKEN).toBe("");
        });

        it("leaves non-string env values untouched", () => {
            const out = encryptConfig("stdio", {
                command: "npx",
                env: { COUNT: 5 as unknown as string, FLAG: true as unknown as string },
            });
            const env = out.env as Record<string, unknown>;
            expect(env.COUNT).toBe(5);
            expect(env.FLAG).toBe(true);
        });

        it("leaves an array-shaped env/headers field untouched (mapObject guards against arrays)", () => {
            const out = encryptConfig("stdio", {
                command: "npx",
                env: ["not", "a", "map"] as unknown as Record<string, string>,
            });
            expect(out.env).toEqual(["not", "a", "map"]);
        });

        it("leaves a null env/headers field untouched", () => {
            const out = encryptConfig("stdio", { command: "npx", env: null as unknown as undefined });
            expect(out.env).toBeNull();
        });
    });

    describe("decryptConfig", () => {
        it("round-trips a stdio env value through encrypt -> decrypt", () => {
            const encrypted = encryptConfig("stdio", {
                command: "npx",
                args: ["-y", "pkg"],
                env: { GITHUB_TOKEN: "super-secret-token" },
            });
            const { config, decryptFailed } = decryptConfig("stdio", encrypted);
            expect(decryptFailed).toBe(false);
            expect((config.env as Record<string, string>).GITHUB_TOKEN).toBe("super-secret-token");
            expect(config.command).toBe("npx");
            expect(config.args).toEqual(["-y", "pkg"]);
        });

        it("round-trips an http headers value through encrypt -> decrypt", () => {
            const encrypted = encryptConfig("http", {
                url: "https://example.com/mcp",
                headers: { Authorization: "Bearer abc123" },
            });
            const { config, decryptFailed } = decryptConfig("http", encrypted);
            expect(decryptFailed).toBe(false);
            expect((config.headers as Record<string, string>).Authorization).toBe("Bearer abc123");
        });

        it("passes plaintext values through unchanged (no ENC_PREFIX -> no decrypt attempt)", () => {
            // Simulates rows written by an external import / old migration
            // that never encrypted secrets in the first place.
            const { config, decryptFailed } = decryptConfig("stdio", {
                command: "npx",
                env: { TOKEN: "already-plaintext" },
            });
            expect(decryptFailed).toBe(false);
            expect((config.env as Record<string, string>).TOKEN).toBe("already-plaintext");
        });

        it("handles a missing env/headers field without throwing", () => {
            const { config, decryptFailed } = decryptConfig("http", { url: "https://example.com" });
            expect(decryptFailed).toBe(false);
            expect(config.headers).toBeUndefined();
        });

        it("flags decryptFailed and blanks the field for corrupt ciphertext", () => {
            const { config, decryptFailed } = decryptConfig("stdio", {
                command: "npx",
                env: { TOKEN: `${ENC_PREFIX}not-valid-base64-ciphertext!!!` },
            });
            expect(decryptFailed).toBe(true);
            expect((config.env as Record<string, string>).TOKEN).toBe("");
        });

        it("flags decryptFailed for ciphertext that's too short to contain iv+tag", () => {
            const { config, decryptFailed } = decryptConfig("stdio", {
                command: "npx",
                env: { TOKEN: `${ENC_PREFIX}${Buffer.from("short").toString("base64")}` },
            });
            expect(decryptFailed).toBe(true);
            expect((config.env as Record<string, string>).TOKEN).toBe("");
        });

        it("isolates a corrupt field from other, still-valid fields in the same config", () => {
            const goodEncrypted = encryptConfig("stdio", { command: "npx", env: { GOOD: "fine" } });
            const goodValue = (goodEncrypted.env as Record<string, string>).GOOD;
            const { config, decryptFailed } = decryptConfig("stdio", {
                command: "npx",
                env: {
                    GOOD: goodValue,
                    BAD: `${ENC_PREFIX}garbage`,
                },
            });
            expect(decryptFailed).toBe(true);
            const env = config.env as Record<string, string>;
            expect(env.GOOD).toBe("fine");
            expect(env.BAD).toBe("");
        });

        it("only decrypts headers for http and only env for stdio", () => {
            const stdioResult = decryptConfig("stdio", {
                command: "npx",
                env: { TOKEN: "plain" },
                headers: { Authorization: `${ENC_PREFIX}should-not-be-touched` },
            });
            // headers untouched (and therefore not decrypted / not flagged).
            expect(stdioResult.decryptFailed).toBe(false);
            expect(stdioResult.config.headers).toEqual({ Authorization: `${ENC_PREFIX}should-not-be-touched` });

            const httpResult = decryptConfig("http", {
                url: "https://example.com",
                headers: { Authorization: "plain" },
                env: { TOKEN: `${ENC_PREFIX}should-not-be-touched` },
            });
            expect(httpResult.decryptFailed).toBe(false);
            expect(httpResult.config.env).toEqual({ TOKEN: `${ENC_PREFIX}should-not-be-touched` });
        });

        it("leaves non-string values untouched when decrypting", () => {
            const { config } = decryptConfig("stdio", {
                command: "npx",
                env: { COUNT: 5 as unknown as string },
            });
            expect((config.env as Record<string, unknown>).COUNT).toBe(5);
        });

        it("leaves an array-shaped env field untouched when decrypting", () => {
            const { config } = decryptConfig("stdio", {
                command: "npx",
                env: ["not", "a", "map"] as unknown as Record<string, string>,
            });
            expect(config.env).toEqual(["not", "a", "map"]);
        });
    });

    describe("DecryptionFailedError", () => {
        it("has the expected name and message", () => {
            const err = new DecryptionFailedError();
            expect(err).toBeInstanceOf(Error);
            expect(err.name).toBe("DecryptionFailedError");
            expect(err.message).toMatch(/master key may have changed/);
        });
    });
});
