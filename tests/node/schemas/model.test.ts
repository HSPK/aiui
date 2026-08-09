import { describe, expect, it } from "vitest";
import { pricingSchema, modelDTOSchema, modelCreateSchema, modelUpdateSchema } from "@/lib/schemas/model";

describe("pricingSchema", () => {
    it("accepts an arbitrary record of unknown values", () => {
        const result = pricingSchema.safeParse({ input: 0.01, output: 0.02, currency: "USD" });
        expect(result.success).toBe(true);
    });

    it("accepts an empty record", () => {
        expect(pricingSchema.safeParse({}).success).toBe(true);
    });

    it("rejects a non-object value", () => {
        expect(pricingSchema.safeParse("free").success).toBe(false);
    });
});

describe("modelDTOSchema", () => {
    const valid = {
        id: "model-1",
        name: "gpt-4o-mini",
        model_id: "gpt-4o-mini",
        proxy: "https://api.openai.com/v1",
        timeout: 3600,
        max_retries: 2,
        default_params: {},
        type: "chat",
        api_variant_id: null,
        resolved_variant_id: "chat.completions",
        pricing: null,
        output_dimension: null,
        context_window: 128000,
        max_tokens: 4096,
        description: null,
        knowledge_date: null,
        provider: "openai",
        provider_id: "prov-1",
        is_local: false,
        enabled: true,
    };

    it("parses a minimal valid model DTO", () => {
        expect(modelDTOSchema.safeParse(valid).success).toBe(true);
    });

    it("accepts optional is_discovered, meta, created_at, updated_at", () => {
        const result = modelDTOSchema.safeParse({
            ...valid,
            is_discovered: true,
            meta: { upstream_id: "gpt-4o-mini" },
            created_at: "2024-01-01T00:00:00.000Z",
            updated_at: "2024-01-01T00:00:00.000Z",
        });
        expect(result.success).toBe(true);
    });

    it("accepts a null meta", () => {
        expect(modelDTOSchema.safeParse({ ...valid, meta: null }).success).toBe(true);
    });

    it("applies meta defaults (supported_apis / capabilities) when meta is provided", () => {
        const result = modelDTOSchema.safeParse({ ...valid, meta: { upstream_id: "x" } });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.meta?.supported_apis).toEqual([]);
            expect(result.data.meta?.capabilities).toEqual({});
        }
    });

    it("rejects a non-integer timeout", () => {
        expect(modelDTOSchema.safeParse({ ...valid, timeout: 1.5 }).success).toBe(false);
    });

    it("rejects a missing provider_id", () => {
        const { provider_id, ...rest } = valid;
        expect(modelDTOSchema.safeParse(rest).success).toBe(false);
    });

    it("rejects a non-record default_params", () => {
        expect(modelDTOSchema.safeParse({ ...valid, default_params: "oops" }).success).toBe(false);
    });
});

describe("modelCreateSchema", () => {
    it("accepts the minimal required fields", () => {
        const result = modelCreateSchema.safeParse({
            name: "gpt-4o-mini",
            provider_id: "prov-1",
            upstream_model_id: "gpt-4o-mini",
        });
        expect(result.success).toBe(true);
    });

    it("trims name, provider_id and upstream_model_id", () => {
        const result = modelCreateSchema.safeParse({
            name: "  gpt-4o-mini  ",
            provider_id: "  prov-1  ",
            upstream_model_id: "  gpt-4o-mini  ",
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.name).toBe("gpt-4o-mini");
            expect(result.data.provider_id).toBe("prov-1");
            expect(result.data.upstream_model_id).toBe("gpt-4o-mini");
        }
    });

    it("rejects an empty name", () => {
        const result = modelCreateSchema.safeParse({
            name: "",
            provider_id: "prov-1",
            upstream_model_id: "gpt-4o-mini",
        });
        expect(result.success).toBe(false);
        if (!result.success) expect(result.error.issues[0].message).toBe("Model name is required");
    });

    it("rejects an empty provider_id", () => {
        const result = modelCreateSchema.safeParse({
            name: "gpt-4o-mini",
            provider_id: "",
            upstream_model_id: "gpt-4o-mini",
        });
        expect(result.success).toBe(false);
        if (!result.success) expect(result.error.issues[0].message).toBe("provider_id is required");
    });

    it("rejects an empty upstream_model_id", () => {
        const result = modelCreateSchema.safeParse({
            name: "gpt-4o-mini",
            provider_id: "prov-1",
            upstream_model_id: "",
        });
        expect(result.success).toBe(false);
        if (!result.success) expect(result.error.issues[0].message).toBe("upstream_model_id is required");
    });

    it("allows api_variant_id to be null (explicit auto)", () => {
        const result = modelCreateSchema.safeParse({
            name: "gpt-4o-mini",
            provider_id: "prov-1",
            upstream_model_id: "gpt-4o-mini",
            api_variant_id: null,
        });
        expect(result.success).toBe(true);
    });

    it("accepts context_window / max_tokens / output_dimension as null", () => {
        const result = modelCreateSchema.safeParse({
            name: "gpt-4o-mini",
            provider_id: "prov-1",
            upstream_model_id: "gpt-4o-mini",
            context_window: null,
            max_tokens: null,
            output_dimension: null,
        });
        expect(result.success).toBe(true);
    });

    it("rejects a negative timeout", () => {
        const result = modelCreateSchema.safeParse({
            name: "gpt-4o-mini",
            provider_id: "prov-1",
            upstream_model_id: "gpt-4o-mini",
            timeout: -1,
        });
        expect(result.success).toBe(false);
    });

    it("accepts max_retries of 0", () => {
        const result = modelCreateSchema.safeParse({
            name: "gpt-4o-mini",
            provider_id: "prov-1",
            upstream_model_id: "gpt-4o-mini",
            max_retries: 0,
        });
        expect(result.success).toBe(true);
    });

    it("rejects a negative max_retries", () => {
        const result = modelCreateSchema.safeParse({
            name: "gpt-4o-mini",
            provider_id: "prov-1",
            upstream_model_id: "gpt-4o-mini",
            max_retries: -1,
        });
        expect(result.success).toBe(false);
    });

    it("accepts arbitrary discovered_metadata", () => {
        const result = modelCreateSchema.safeParse({
            name: "gpt-4o-mini",
            provider_id: "prov-1",
            upstream_model_id: "gpt-4o-mini",
            discovered_metadata: { id: "gpt-4o-mini", context_length: 128000 },
        });
        expect(result.success).toBe(true);
    });

    it("accepts a null pricing", () => {
        const result = modelCreateSchema.safeParse({
            name: "gpt-4o-mini",
            provider_id: "prov-1",
            upstream_model_id: "gpt-4o-mini",
            pricing: null,
        });
        expect(result.success).toBe(true);
    });
});

describe("modelUpdateSchema", () => {
    it("accepts an empty object", () => {
        expect(modelUpdateSchema.safeParse({}).success).toBe(true);
    });

    it("still enforces non-empty name when name is provided", () => {
        expect(modelUpdateSchema.safeParse({ name: "" }).success).toBe(false);
    });

    it("allows a partial update of just enabled", () => {
        expect(modelUpdateSchema.safeParse({ enabled: false }).success).toBe(true);
    });
});
