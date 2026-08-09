import { describe, expect, it } from "vitest";
import { imagesGenerationsVariant } from "@/lib/server/api-variants/images-generations";
import type { VariantContext } from "@/lib/server/api-variants";
import { getCapability } from "@/lib/server/capabilities";
import "@/lib/server/capabilities/register";
import { makeModel, makeProvider } from "./fixtures";

const ctx: VariantContext = {
    provider: makeProvider(),
    model: makeModel({ type: "image" }),
    meta: null,
    capability: getCapability("image")!,
    stream: false,
};

describe("api-variants/images-generations — descriptor", () => {
    it("declares the expected wire shape", () => {
        expect(imagesGenerationsVariant.id).toBe("images.generations");
        expect(imagesGenerationsVariant.capability).toBe("image");
        expect(imagesGenerationsVariant.path).toBe("/images/generations");
        expect(imagesGenerationsVariant.supportsStreaming).toBe(false);
    });
});

describe("api-variants/images-generations — parseResponse", () => {
    it("summarizes a single generated image (singular grammar)", () => {
        const json = { data: [{ b64_json: "AAA" }] };
        const result = imagesGenerationsVariant.parseResponse(json, ctx);
        expect(result.output).toBe("Generated 1 image");
        expect(result.normalized).toBe(json);
    });

    it("summarizes multiple generated images (plural grammar)", () => {
        const result = imagesGenerationsVariant.parseResponse({ data: [{ url: "a" }, { url: "b" }, { url: "c" }] }, ctx);
        expect(result.output).toBe("Generated 3 images");
    });

    it("reports token usage when present (gpt-image-1 style)", () => {
        const result = imagesGenerationsVariant.parseResponse(
            { data: [{ b64_json: "AAA" }], usage: { input_tokens: 5, output_tokens: 100, total_tokens: 105 } },
            ctx,
        );
        expect(result.promptTokens).toBe(5);
        expect(result.completionTokens).toBe(100);
        expect(result.totalTokens).toBe(105);
    });

    it("has null token usage when absent (legacy DALL·E style)", () => {
        const result = imagesGenerationsVariant.parseResponse({ data: [{ url: "a" }] }, ctx);
        expect(result.promptTokens).toBeNull();
        expect(result.completionTokens).toBeNull();
        expect(result.totalTokens).toBeNull();
    });

    it("returns null output when there is no image data", () => {
        expect(imagesGenerationsVariant.parseResponse({}, ctx).output).toBeNull();
        expect(imagesGenerationsVariant.parseResponse({ data: [] }, ctx).output).toBeNull();
    });

    it("handles a null json body without throwing, defaulting normalized to {}", () => {
        const result = imagesGenerationsVariant.parseResponse(null, ctx);
        expect(result.output).toBeNull();
        expect(result.promptTokens).toBeNull();
        expect(result.normalized).toEqual({});
    });

    it("surfaces a 200-with-error envelope", () => {
        const result = imagesGenerationsVariant.parseResponse({ error: { message: "content policy violation" } }, ctx);
        expect(result.error).toBe("content policy violation");
    });
});

describe("api-variants/images-generations — parseStreamChunk", () => {
    it("always returns null (non-streaming variant)", () => {
        expect(imagesGenerationsVariant.parseStreamChunk({}, ctx)).toBeNull();
    });
});
