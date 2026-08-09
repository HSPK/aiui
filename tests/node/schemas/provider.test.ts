import { describe, expect, it } from "vitest";
import {
    providerDTOSchema,
    providerProbeSchema,
    providerCreateSchema,
    providerUpdateSchema,
} from "@/lib/schemas/provider";

describe("providerDTOSchema", () => {
    const valid = {
        id: "prov-1",
        name: "openai",
        provider_name: "openai",
        adapter_id: "openai",
        base_url: "https://api.openai.com/v1",
        proxy: "https://api.openai.com/v1",
        api_version: null,
        has_api_key: true,
        default_params: {},
        document_page: "",
        model_page: "",
        health_check_url: null,
        last_health_status: null,
        last_health_checked_at: null,
        last_health_error: null,
        is_local: false,
        enabled: true,
        created_at: "2024-01-01T00:00:00.000Z",
        updated_at: "2024-01-01T00:00:00.000Z",
    };

    it("parses a full valid provider DTO", () => {
        expect(providerDTOSchema.safeParse(valid).success).toBe(true);
    });

    it("accepts optional n_models", () => {
        expect(providerDTOSchema.safeParse({ ...valid, n_models: 5 }).success).toBe(true);
    });

    it("accepts a non-null health check status of ok/down", () => {
        expect(
            providerDTOSchema.safeParse({ ...valid, last_health_status: "ok", health_check_url: "https://x.com" })
                .success,
        ).toBe(true);
        expect(providerDTOSchema.safeParse({ ...valid, last_health_status: "down" }).success).toBe(true);
    });

    it("rejects an invalid last_health_status", () => {
        expect(providerDTOSchema.safeParse({ ...valid, last_health_status: "unknown" }).success).toBe(false);
    });

    it("rejects an empty adapter_id (min length 1 after trim)", () => {
        expect(providerDTOSchema.safeParse({ ...valid, adapter_id: "" }).success).toBe(false);
    });
});

describe("providerProbeSchema", () => {
    it("accepts a valid, trimmed URL", () => {
        const result = providerProbeSchema.safeParse({ health_check_url: "  https://api.example.com/health  " });
        expect(result.success).toBe(true);
        if (result.success) expect(result.data.health_check_url).toBe("https://api.example.com/health");
    });

    it("rejects an empty health_check_url", () => {
        const result = providerProbeSchema.safeParse({ health_check_url: "" });
        expect(result.success).toBe(false);
        if (!result.success) expect(result.error.issues[0].message).toBe("health_check_url is required");
    });

    it("rejects a non-URL string", () => {
        const result = providerProbeSchema.safeParse({ health_check_url: "not-a-url" });
        expect(result.success).toBe(false);
        if (!result.success) expect(result.error.issues[0].message).toBe("health_check_url must be a URL");
    });
});

describe("providerCreateSchema", () => {
    it("accepts the minimal required fields", () => {
        const result = providerCreateSchema.safeParse({
            name: "openai",
            base_url: "https://api.openai.com/v1",
        });
        expect(result.success).toBe(true);
    });

    it("trims the provider name", () => {
        const result = providerCreateSchema.safeParse({ name: "  openai  ", base_url: "https://api.openai.com" });
        expect(result.success).toBe(true);
        if (result.success) expect(result.data.name).toBe("openai");
    });

    it("rejects an empty name", () => {
        const result = providerCreateSchema.safeParse({ name: "", base_url: "https://api.openai.com" });
        expect(result.success).toBe(false);
        if (!result.success) expect(result.error.issues[0].message).toBe("Provider name is required");
    });

    it("rejects an empty base_url", () => {
        const result = providerCreateSchema.safeParse({ name: "openai", base_url: "" });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues.some((i) => i.message === "base_url is required")).toBe(true);
        }
    });

    it("rejects a non-URL base_url", () => {
        const result = providerCreateSchema.safeParse({ name: "openai", base_url: "not-a-url" });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues.some((i) => i.message === "base_url must be a URL")).toBe(true);
        }
    });

    it("allows adapter_id to be omitted (auto-detect)", () => {
        const result = providerCreateSchema.safeParse({ name: "openai", base_url: "https://api.openai.com" });
        expect(result.success).toBe(true);
        if (result.success) expect(result.data.adapter_id).toBeUndefined();
    });

    it("accepts a null api_key and api_version", () => {
        const result = providerCreateSchema.safeParse({
            name: "openai",
            base_url: "https://api.openai.com",
            api_key: null,
            api_version: null,
        });
        expect(result.success).toBe(true);
    });

    it("accepts a null health_check_url", () => {
        const result = providerCreateSchema.safeParse({
            name: "openai",
            base_url: "https://api.openai.com",
            health_check_url: null,
        });
        expect(result.success).toBe(true);
    });

    it("trims and validates a supplied health_check_url", () => {
        const result = providerCreateSchema.safeParse({
            name: "openai",
            base_url: "https://api.openai.com",
            health_check_url: "  https://api.openai.com/health  ",
        });
        expect(result.success).toBe(true);
        if (result.success) expect(result.data.health_check_url).toBe("https://api.openai.com/health");
    });

    it("rejects an invalid health_check_url", () => {
        const result = providerCreateSchema.safeParse({
            name: "openai",
            base_url: "https://api.openai.com",
            health_check_url: "not-a-url",
        });
        expect(result.success).toBe(false);
    });

    it("accepts default_params, document_page, model_page, is_local, enabled", () => {
        const result = providerCreateSchema.safeParse({
            name: "openai",
            base_url: "https://api.openai.com",
            default_params: { temperature: 0.5 },
            document_page: "https://docs.example.com",
            model_page: "https://models.example.com",
            is_local: true,
            enabled: false,
        });
        expect(result.success).toBe(true);
    });
});

describe("providerUpdateSchema", () => {
    it("accepts an empty object", () => {
        expect(providerUpdateSchema.safeParse({}).success).toBe(true);
    });

    it("still validates base_url shape when provided", () => {
        expect(providerUpdateSchema.safeParse({ base_url: "nope" }).success).toBe(false);
    });

    it("allows a partial update of just enabled", () => {
        expect(providerUpdateSchema.safeParse({ enabled: false }).success).toBe(true);
    });
});
