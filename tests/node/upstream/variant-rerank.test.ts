import { describe, expect, it } from "vitest";
import { rerankVariant } from "@/lib/server/api-variants/rerank";
import type { VariantContext } from "@/lib/server/api-variants";
import { getCapability } from "@/lib/server/capabilities";
import "@/lib/server/capabilities/register";
import { makeModel, makeProvider } from "./fixtures";

const ctx: VariantContext = {
    provider: makeProvider(),
    model: makeModel({ type: "rerank" }),
    meta: null,
    capability: getCapability("rerank")!,
    stream: false,
};

describe("api-variants/rerank — descriptor", () => {
    it("declares the expected wire shape", () => {
        expect(rerankVariant.id).toBe("rerank");
        expect(rerankVariant.capability).toBe("rerank");
        expect(rerankVariant.path).toBe("/rerank");
        expect(rerankVariant.supportsStreaming).toBe(false);
    });
});

describe("api-variants/rerank — parseResponse", () => {
    it("summarizes a single result (singular grammar)", () => {
        const json = { results: [{ index: 0, relevance_score: 0.9 }] };
        const result = rerankVariant.parseResponse(json, ctx);
        expect(result.output).toBe("Reranked 1 document");
        expect(result.normalized).toBe(json);
    });

    it("summarizes multiple results (plural grammar)", () => {
        const result = rerankVariant.parseResponse({ results: [{ index: 0 }, { index: 1 }, { index: 2 }] }, ctx);
        expect(result.output).toBe("Reranked 3 documents");
    });

    it("summarizes 0 documents when results is missing or not an array", () => {
        expect(rerankVariant.parseResponse({}, ctx).output).toBe("Reranked 0 documents");
        expect(rerankVariant.parseResponse({ results: "not-an-array" }, ctx).output).toBe("Reranked 0 documents");
    });

    it("handles a null json body without throwing, defaulting normalized to {}", () => {
        const result = rerankVariant.parseResponse(null, ctx);
        expect(result.output).toBe("Reranked 0 documents");
        expect(result.normalized).toEqual({});
    });

    it("has null token usage (rerank has no token accounting)", () => {
        const result = rerankVariant.parseResponse({ results: [] }, ctx);
        expect(result.promptTokens).toBeNull();
        expect(result.completionTokens).toBeNull();
        expect(result.totalTokens).toBeNull();
    });

    it("surfaces a 200-with-error envelope", () => {
        const result = rerankVariant.parseResponse({ error: { message: "too many documents" } }, ctx);
        expect(result.error).toBe("too many documents");
    });
});

describe("api-variants/rerank — parseStreamChunk", () => {
    it("always returns null (non-streaming variant)", () => {
        expect(rerankVariant.parseStreamChunk({}, ctx)).toBeNull();
    });
});
