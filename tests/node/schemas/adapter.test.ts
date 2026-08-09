import { describe, expect, it } from "vitest";
import {
    upstreamApiIdSchema,
    modelCapabilitiesSchema,
    normalizedModelMetaSchema,
    adapterIdSchema,
    adapterDescriptorSchema,
} from "@/lib/schemas/adapter";

describe("upstreamApiIdSchema", () => {
    it.each([
        "chat.completions",
        "responses",
        "embeddings",
        "images.generations",
        "audio.speech",
        "audio.transcriptions",
        "rerank",
        "videos",
    ])("accepts %s", (id) => {
        expect(upstreamApiIdSchema.safeParse(id).success).toBe(true);
    });

    it("rejects an unregistered upstream api id", () => {
        expect(upstreamApiIdSchema.safeParse("videos.generations").success).toBe(false);
    });
});

describe("modelCapabilitiesSchema", () => {
    it("accepts an empty object (everything optional)", () => {
        expect(modelCapabilitiesSchema.safeParse({}).success).toBe(true);
    });

    it("accepts all flags set", () => {
        const result = modelCapabilitiesSchema.safeParse({
            chat: true,
            embeddings: false,
            responses: true,
            tools: true,
            vision: false,
            audio_in: true,
            audio_out: false,
            json_schema: true,
            batch: false,
            reasoning: true,
        });
        expect(result.success).toBe(true);
    });

    it("rejects a non-boolean flag", () => {
        expect(modelCapabilitiesSchema.safeParse({ chat: "yes" }).success).toBe(false);
    });
});

describe("normalizedModelMetaSchema", () => {
    it("requires upstream_id", () => {
        expect(normalizedModelMetaSchema.safeParse({}).success).toBe(false);
    });

    it("applies defaults for supported_apis and capabilities", () => {
        const result = normalizedModelMetaSchema.parse({ upstream_id: "gpt-4o-mini" });
        expect(result.supported_apis).toEqual([]);
        expect(result.capabilities).toEqual({});
    });

    it("accepts a fully populated meta object", () => {
        const result = normalizedModelMetaSchema.safeParse({
            upstream_id: "gpt-4o-mini",
            label: "GPT-4o mini",
            supported_apis: ["chat.completions", "responses"],
            capabilities: { chat: true, vision: true },
            accepted_fields: ["temperature", "max_tokens"],
            rejected_fields: ["stream_options"],
            context_window: 128000,
            max_output_tokens: 4096,
            publisher: "OpenAI",
            version: "2024-08-06",
            format: "gguf",
            owned_by: "openai",
            rate_limits: { requests: 500, tokens: 100000, window_seconds: 60 },
            pricing: { input: 0.01, output: 0.02, currency: "USD" },
            raw: { id: "gpt-4o-mini" },
        });
        expect(result.success).toBe(true);
    });

    it("allows context_window / max_output_tokens to be null", () => {
        const result = normalizedModelMetaSchema.safeParse({
            upstream_id: "x",
            context_window: null,
            max_output_tokens: null,
        });
        expect(result.success).toBe(true);
    });

    it("allows publisher / version / format / owned_by to be null", () => {
        const result = normalizedModelMetaSchema.safeParse({
            upstream_id: "x",
            publisher: null,
            version: null,
            format: null,
            owned_by: null,
        });
        expect(result.success).toBe(true);
    });

    it("rejects an invalid entry in supported_apis", () => {
        const result = normalizedModelMetaSchema.safeParse({
            upstream_id: "x",
            supported_apis: ["not-a-real-api"],
        });
        expect(result.success).toBe(false);
    });

    it("accepts an empty accepted_fields array (treated as 'pass everything through')", () => {
        const result = normalizedModelMetaSchema.safeParse({ upstream_id: "x", accepted_fields: [] });
        expect(result.success).toBe(true);
    });

    it("rejects a non-integer rate_limits.requests", () => {
        const result = normalizedModelMetaSchema.safeParse({
            upstream_id: "x",
            rate_limits: { requests: 1.5 },
        });
        expect(result.success).toBe(false);
    });

    it("accepts raw as any unknown shape, including primitives", () => {
        expect(normalizedModelMetaSchema.safeParse({ upstream_id: "x", raw: "raw string" }).success).toBe(true);
        expect(normalizedModelMetaSchema.safeParse({ upstream_id: "x", raw: 42 }).success).toBe(true);
        expect(normalizedModelMetaSchema.safeParse({ upstream_id: "x", raw: null }).success).toBe(true);
    });
});

describe("adapterIdSchema", () => {
    it("accepts and trims a non-empty id", () => {
        const result = adapterIdSchema.safeParse("  openai  ");
        expect(result.success).toBe(true);
        if (result.success) expect(result.data).toBe("openai");
    });

    it("rejects an empty string", () => {
        expect(adapterIdSchema.safeParse("").success).toBe(false);
    });

    it("rejects a whitespace-only string", () => {
        expect(adapterIdSchema.safeParse("   ").success).toBe(false);
    });
});

describe("adapterDescriptorSchema", () => {
    it("accepts id + label without a description", () => {
        expect(adapterDescriptorSchema.safeParse({ id: "openai", label: "OpenAI" }).success).toBe(true);
    });

    it("accepts an optional description", () => {
        expect(
            adapterDescriptorSchema.safeParse({ id: "openai", label: "OpenAI", description: "OpenAI-compatible" })
                .success,
        ).toBe(true);
    });

    it("rejects a missing label", () => {
        expect(adapterDescriptorSchema.safeParse({ id: "openai" }).success).toBe(false);
    });

    it("rejects an empty id (adapterIdSchema enforces min length)", () => {
        expect(adapterDescriptorSchema.safeParse({ id: "", label: "OpenAI" }).success).toBe(false);
    });
});
