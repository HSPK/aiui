import { describe, expect, it } from "vitest";
import {
    apiKeyDTOSchema,
    apiKeyCreatedDTOSchema,
    apiKeyCreateSchema,
} from "@/lib/schemas/apikey";

describe("apiKeyDTOSchema", () => {
    const valid = {
        id: "key-1",
        name: "CI key",
        prefix: "sk-abcd",
        last_used_at: null,
        expires_at: null,
        created_at: "2024-01-01T00:00:00.000Z",
    };

    it("parses a valid API key DTO", () => {
        expect(apiKeyDTOSchema.parse(valid)).toEqual(valid);
    });

    it("accepts non-null last_used_at / expires_at strings", () => {
        const result = apiKeyDTOSchema.safeParse({
            ...valid,
            last_used_at: "2024-02-01T00:00:00.000Z",
            expires_at: "2025-01-01T00:00:00.000Z",
        });
        expect(result.success).toBe(true);
    });

    it("rejects undefined last_used_at (must be explicitly null or a string)", () => {
        const { last_used_at, ...rest } = valid;
        const result = apiKeyDTOSchema.safeParse(rest);
        expect(result.success).toBe(false);
    });
});

describe("apiKeyCreatedDTOSchema", () => {
    it("extends the DTO with a required plaintext key", () => {
        const input = {
            id: "key-1",
            name: "CI key",
            prefix: "sk-abcd",
            last_used_at: null,
            expires_at: null,
            created_at: "2024-01-01T00:00:00.000Z",
            key: "sk-abcdefghijklmnop",
        };
        expect(apiKeyCreatedDTOSchema.parse(input)).toEqual(input);
    });

    it("rejects when the plaintext key is missing", () => {
        const result = apiKeyCreatedDTOSchema.safeParse({
            id: "key-1",
            name: "CI key",
            prefix: "sk-abcd",
            last_used_at: null,
            expires_at: null,
            created_at: "2024-01-01T00:00:00.000Z",
        });
        expect(result.success).toBe(false);
    });
});

describe("apiKeyCreateSchema", () => {
    it("accepts just a trimmed name", () => {
        const result = apiKeyCreateSchema.safeParse({ name: "  My Key  " });
        expect(result.success).toBe(true);
        if (result.success) expect(result.data.name).toBe("My Key");
    });

    it("rejects an empty name", () => {
        const result = apiKeyCreateSchema.safeParse({ name: "" });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues[0].message).toBe("API key name is required");
        }
    });

    it("rejects a whitespace-only name (trimmed to empty)", () => {
        const result = apiKeyCreateSchema.safeParse({ name: "   " });
        expect(result.success).toBe(false);
    });

    it("accepts a null expires_at", () => {
        const result = apiKeyCreateSchema.safeParse({ name: "k", expires_at: null });
        expect(result.success).toBe(true);
    });

    it("accepts an omitted expires_at", () => {
        const result = apiKeyCreateSchema.safeParse({ name: "k" });
        expect(result.success).toBe(true);
        if (result.success) expect(result.data.expires_at).toBeUndefined();
    });

    it("accepts a valid ISO datetime expires_at", () => {
        const result = apiKeyCreateSchema.safeParse({ name: "k", expires_at: "2025-01-01T00:00:00Z" });
        expect(result.success).toBe(true);
    });

    it("rejects a non-datetime expires_at string", () => {
        const result = apiKeyCreateSchema.safeParse({ name: "k", expires_at: "not-a-date" });
        expect(result.success).toBe(false);
    });

    it("rejects a date-only (no time) expires_at string", () => {
        const result = apiKeyCreateSchema.safeParse({ name: "k", expires_at: "2025-01-01" });
        expect(result.success).toBe(false);
    });
});
