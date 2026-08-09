import { describe, expect, it } from "vitest";
import { loomConfigSchema } from "@/lib/schemas/config";

describe("loomConfigSchema", () => {
    it("accepts a completely empty object (all fields optional)", () => {
        expect(loomConfigSchema.safeParse({}).success).toBe(true);
    });

    it("accepts a config with only master_key set", () => {
        const result = loomConfigSchema.safeParse({ master_key: "secret" });
        expect(result.success).toBe(true);
    });

    it("preserves unknown top-level keys (.loose())", () => {
        const result = loomConfigSchema.safeParse({ master_key: "secret", future_field: "kept" });
        expect(result.success).toBe(true);
        if (result.success) expect((result.data as Record<string, unknown>).future_field).toBe("kept");
    });

    it("preserves unknown keys inside nested .loose() objects", () => {
        const result = loomConfigSchema.safeParse({
            database: { path: "./data.db", future_flag: true },
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect((result.data.database as Record<string, unknown>).future_flag).toBe(true);
        }
    });

    it("accepts a fully populated config", () => {
        const result = loomConfigSchema.safeParse({
            master_key: "secret",
            database: { path: "./data/loom.db" },
            server: { port: 3000, hostname: "0.0.0.0", trust_proxy: true },
            admin: { username: "admin", password: "hunter2" },
            session: { ttl_days: 30 },
            cache: { models_ttl_seconds: 600 },
            providers: [{ name: "openai", base_url: "https://api.openai.com/v1" }],
        });
        expect(result.success).toBe(true);
    });

    it("rejects a non-positive server.port", () => {
        expect(loomConfigSchema.safeParse({ server: { port: 0 } }).success).toBe(false);
    });

    it("rejects a non-integer server.port", () => {
        expect(loomConfigSchema.safeParse({ server: { port: 3000.5 } }).success).toBe(false);
    });

    it("rejects a non-positive session.ttl_days", () => {
        expect(loomConfigSchema.safeParse({ session: { ttl_days: 0 } }).success).toBe(false);
    });

    it("accepts cache.models_ttl_seconds of 0", () => {
        expect(loomConfigSchema.safeParse({ cache: { models_ttl_seconds: 0 } }).success).toBe(true);
    });

    it("rejects a negative cache.models_ttl_seconds", () => {
        expect(loomConfigSchema.safeParse({ cache: { models_ttl_seconds: -1 } }).success).toBe(false);
    });

    it("rejects a non-boolean server.trust_proxy", () => {
        expect(loomConfigSchema.safeParse({ server: { trust_proxy: "yes" } }).success).toBe(false);
    });

    it("validates each entry in providers[] against providerCreateSchema", () => {
        const result = loomConfigSchema.safeParse({
            providers: [{ name: "", base_url: "https://api.openai.com/v1" }],
        });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues.some((i) => i.path.join(".") === "providers.0.name")).toBe(true);
        }
    });

    it("accepts an empty providers array", () => {
        expect(loomConfigSchema.safeParse({ providers: [] }).success).toBe(true);
    });

    it("rejects a non-object database value", () => {
        expect(loomConfigSchema.safeParse({ database: "not-an-object" }).success).toBe(false);
    });
});
