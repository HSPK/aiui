import { describe, expect, it } from "vitest";
import { embeddingsVariant } from "@/lib/server/api-variants/embeddings";
import type { VariantContext } from "@/lib/server/api-variants";
import { getCapability } from "@/lib/server/capabilities";
import "@/lib/server/capabilities/register";
import { makeModel, makeProvider } from "./fixtures";

const ctx: VariantContext = {
    provider: makeProvider(),
    model: makeModel({ type: "embedding" }),
    meta: null,
    capability: getCapability("embedding")!,
    stream: false,
};

describe("api-variants/embeddings — descriptor", () => {
    it("declares the expected wire shape", () => {
        expect(embeddingsVariant.id).toBe("embeddings");
        expect(embeddingsVariant.capability).toBe("embedding");
        expect(embeddingsVariant.path).toBe("/embeddings");
        expect(embeddingsVariant.supportsStreaming).toBe(false);
        expect(embeddingsVariant.transformRequest).toBeUndefined();
    });
});

describe("api-variants/embeddings — parseResponse", () => {
    it("summarizes vector count × dimension and token usage", () => {
        const json = {
            data: [{ embedding: new Array(1536).fill(0) }, { embedding: new Array(1536).fill(0) }],
            usage: { prompt_tokens: 12, total_tokens: 12 },
        };
        const result = embeddingsVariant.parseResponse(json, ctx);
        expect(result.output).toBe("2 vector(s) × 1536 dim");
        expect(result.promptTokens).toBe(12);
        expect(result.completionTokens).toBeNull();
        expect(result.totalTokens).toBe(12);
        expect(result.normalized).toBe(json);
        expect(result.error).toBeUndefined();
    });

    it("returns null output when there is no embedding data", () => {
        const result = embeddingsVariant.parseResponse({ data: [] }, ctx);
        expect(result.output).toBeNull();
    });

    it("returns null output and usage when the response is empty", () => {
        const result = embeddingsVariant.parseResponse({}, ctx);
        expect(result.output).toBeNull();
        expect(result.promptTokens).toBeNull();
        expect(result.totalTokens).toBeNull();
        expect(result.normalized).toEqual({});
    });

    it("handles a null json body without throwing", () => {
        const result = embeddingsVariant.parseResponse(null, ctx);
        expect(result.output).toBeNull();
        expect(result.normalized).toEqual({});
    });

    it("surfaces a 200-with-error envelope", () => {
        const result = embeddingsVariant.parseResponse({ error: { message: "invalid input" } }, ctx);
        expect(result.error).toBe("invalid input");
    });
});

describe("api-variants/embeddings — parseStreamChunk", () => {
    it("always returns null (non-streaming variant)", () => {
        expect(embeddingsVariant.parseStreamChunk({ any: "thing" }, ctx)).toBeNull();
        expect(embeddingsVariant.parseStreamChunk(null, ctx)).toBeNull();
    });
});
