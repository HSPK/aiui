import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
    playgroundChatSchema,
    playgroundEmbeddingParamsSchema,
    playgroundEmbeddingSchema,
    playgroundEmbeddingDocScoreSchema,
    playgroundEmbeddingModelResultSchema,
    playgroundEmbeddingResultSchema,
} from "@/lib/schemas/playground";

describe("playgroundChatSchema", () => {
    it("accepts the minimal required fields (string content)", () => {
        const result = playgroundChatSchema.safeParse({ content: "hello", model: "gpt-4o-mini" });
        expect(result.success).toBe(true);
    });

    it("accepts multimodal array content", () => {
        const result = playgroundChatSchema.safeParse({
            content: [{ type: "text", text: "hello" }],
            model: "gpt-4o-mini",
        });
        expect(result.success).toBe(true);
    });

    it("rejects an empty model", () => {
        const result = playgroundChatSchema.safeParse({ content: "hi", model: "" });
        expect(result.success).toBe(false);
        if (!result.success) expect(result.error.issues[0].message).toBe("`model` is required");
    });

    it("rejects a missing content field", () => {
        const result = playgroundChatSchema.safeParse({ model: "gpt-4o-mini" });
        expect(result.success).toBe(false);
    });

    it("accepts valid UUIDs for conversation/message ids", () => {
        const result = playgroundChatSchema.safeParse({
            content: "hi",
            model: "gpt-4o-mini",
            conversation_id: randomUUID(),
            parent_message_id: randomUUID(),
            user_message_id: randomUUID(),
            assistant_message_id: randomUUID(),
        });
        expect(result.success).toBe(true);
    });

    it("rejects a non-UUID conversation_id", () => {
        const result = playgroundChatSchema.safeParse({
            content: "hi",
            model: "gpt-4o-mini",
            conversation_id: "not-a-uuid",
        });
        expect(result.success).toBe(false);
    });

    it("allows parent_message_id to be null", () => {
        const result = playgroundChatSchema.safeParse({
            content: "hi",
            model: "gpt-4o-mini",
            parent_message_id: null,
        });
        expect(result.success).toBe(true);
    });

    it("accepts sampling/generation params and reasoning_effort", () => {
        const result = playgroundChatSchema.safeParse({
            content: "hi",
            model: "gpt-4o-mini",
            system: "You are terse.",
            temperature: 0.7,
            max_tokens: 512,
            top_p: 0.9,
            frequency_penalty: 0.1,
            presence_penalty: 0.2,
            reasoning_effort: "high",
            stream: true,
        });
        expect(result.success).toBe(true);
    });

    it("rejects an invalid reasoning_effort", () => {
        const result = playgroundChatSchema.safeParse({
            content: "hi",
            model: "gpt-4o-mini",
            reasoning_effort: "extreme",
        });
        expect(result.success).toBe(false);
    });

    it("rejects history_limit / conv_histrory_limit below 1", () => {
        expect(
            playgroundChatSchema.safeParse({ content: "hi", model: "m", history_limit: 0 }).success,
        ).toBe(false);
        expect(
            playgroundChatSchema.safeParse({ content: "hi", model: "m", conv_histrory_limit: 0 }).success,
        ).toBe(false);
    });

    it("accepts enabled_mcp_server_ids as an array of non-empty strings", () => {
        const result = playgroundChatSchema.safeParse({
            content: "hi",
            model: "m",
            enabled_mcp_server_ids: ["server-1", "server-2"],
        });
        expect(result.success).toBe(true);
    });

    it("rejects an empty string inside enabled_mcp_server_ids", () => {
        const result = playgroundChatSchema.safeParse({
            content: "hi",
            model: "m",
            enabled_mcp_server_ids: [""],
        });
        expect(result.success).toBe(false);
    });

    it("rejects a non-integer max_tokens", () => {
        const result = playgroundChatSchema.safeParse({ content: "hi", model: "m", max_tokens: 1.5 });
        expect(result.success).toBe(false);
    });
});

describe("playgroundEmbeddingParamsSchema", () => {
    it("accepts an empty object (everything optional)", () => {
        expect(playgroundEmbeddingParamsSchema.safeParse({}).success).toBe(true);
    });

    it.each(["float", "base64"])("accepts encoding_format=%s", (encoding_format) => {
        expect(playgroundEmbeddingParamsSchema.safeParse({ encoding_format }).success).toBe(true);
    });

    it("rejects an invalid encoding_format", () => {
        expect(playgroundEmbeddingParamsSchema.safeParse({ encoding_format: "hex" }).success).toBe(false);
    });

    it("rejects a non-positive dimensions", () => {
        expect(playgroundEmbeddingParamsSchema.safeParse({ dimensions: 0 }).success).toBe(false);
    });

    it("accepts input_type and user as free-form strings", () => {
        const result = playgroundEmbeddingParamsSchema.safeParse({ input_type: "search_query", user: "u-1" });
        expect(result.success).toBe(true);
    });
});

describe("playgroundEmbeddingSchema", () => {
    const valid = { models: ["text-embedding-3-small"], query: "cats", documents: ["a cat", "a dog"] };

    it("accepts a valid minimal request", () => {
        expect(playgroundEmbeddingSchema.safeParse(valid).success).toBe(true);
    });

    it("rejects an empty models array", () => {
        const result = playgroundEmbeddingSchema.safeParse({ ...valid, models: [] });
        expect(result.success).toBe(false);
        if (!result.success) expect(result.error.issues[0].message).toBe("Pick at least one model");
    });

    it("rejects an empty query", () => {
        const result = playgroundEmbeddingSchema.safeParse({ ...valid, query: "" });
        expect(result.success).toBe(false);
        if (!result.success) expect(result.error.issues[0].message).toBe("`query` is required");
    });

    it("rejects an empty documents array", () => {
        const result = playgroundEmbeddingSchema.safeParse({ ...valid, documents: [] });
        expect(result.success).toBe(false);
        if (!result.success) expect(result.error.issues[0].message).toBe("Need at least one document");
    });

    it("rejects more than 64 documents", () => {
        const result = playgroundEmbeddingSchema.safeParse({
            ...valid,
            documents: Array.from({ length: 65 }, (_, i) => `doc-${i}`),
        });
        expect(result.success).toBe(false);
    });

    it("accepts exactly 64 documents", () => {
        const result = playgroundEmbeddingSchema.safeParse({
            ...valid,
            documents: Array.from({ length: 64 }, (_, i) => `doc-${i}`),
        });
        expect(result.success).toBe(true);
    });

    it("rejects an empty string inside documents", () => {
        const result = playgroundEmbeddingSchema.safeParse({ ...valid, documents: [""] });
        expect(result.success).toBe(false);
    });

    it("accepts optional params", () => {
        const result = playgroundEmbeddingSchema.safeParse({ ...valid, params: { dimensions: 256 } });
        expect(result.success).toBe(true);
    });
});

describe("playgroundEmbeddingDocScoreSchema", () => {
    it("parses a valid score entry", () => {
        expect(playgroundEmbeddingDocScoreSchema.safeParse({ index: 0, score: 0.87 }).success).toBe(true);
    });

    it("rejects a non-integer index", () => {
        expect(playgroundEmbeddingDocScoreSchema.safeParse({ index: 0.5, score: 0.5 }).success).toBe(false);
    });
});

describe("playgroundEmbeddingModelResultSchema", () => {
    const valid = {
        model: "text-embedding-3-small",
        query_vector: [0.1, 0.2],
        document_vectors: [[0.1, 0.2], null],
        dim: 2,
        scores: [{ index: 0, score: 0.9 }],
        prompt_tokens: 10,
        total_tokens: 10,
        elapsed_ms: 120,
    };

    it("parses a successful result", () => {
        expect(playgroundEmbeddingModelResultSchema.safeParse(valid).success).toBe(true);
    });

    it("parses a failed result with nulled-out vectors and an error message", () => {
        const result = playgroundEmbeddingModelResultSchema.safeParse({
            model: "text-embedding-3-small",
            query_vector: null,
            document_vectors: [null, null],
            dim: null,
            scores: null,
            prompt_tokens: null,
            total_tokens: null,
            elapsed_ms: 50,
            error: "upstream 500",
        });
        expect(result.success).toBe(true);
    });

    it("rejects a non-integer elapsed_ms", () => {
        expect(
            playgroundEmbeddingModelResultSchema.safeParse({ ...valid, elapsed_ms: 1.2 }).success,
        ).toBe(false);
    });
});

describe("playgroundEmbeddingResultSchema", () => {
    it("parses a full result envelope with nested model results", () => {
        const result = playgroundEmbeddingResultSchema.safeParse({
            query: "cats",
            documents: ["a cat"],
            results: [
                {
                    model: "text-embedding-3-small",
                    query_vector: [0.1],
                    document_vectors: [[0.1]],
                    dim: 1,
                    scores: [{ index: 0, score: 1 }],
                    prompt_tokens: 1,
                    total_tokens: 1,
                    elapsed_ms: 10,
                },
            ],
        });
        expect(result.success).toBe(true);
    });

    it("rejects an invalid nested model result", () => {
        const result = playgroundEmbeddingResultSchema.safeParse({
            query: "cats",
            documents: ["a cat"],
            results: [{ model: "m" }],
        });
        expect(result.success).toBe(false);
    });
});
