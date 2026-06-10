import "server-only";
import { extractUpstreamError, registerVariant, type UpstreamApiVariant } from ".";

export const rerankVariant: UpstreamApiVariant = {
    id: "rerank",
    capability: "rerank",
    path: "/rerank",
    supportsStreaming: false,

    parseResponse(json) {
        const results = (json as { results?: unknown[] })?.results;
        const count = Array.isArray(results) ? results.length : 0;
        return {
            output: `Reranked ${count} document${count === 1 ? "" : "s"}`,
            promptTokens: null,
            completionTokens: null,
            totalTokens: null,
            normalized: (json ?? {}) as Record<string, unknown>,
            error: extractUpstreamError(json),
        };
    },

    parseStreamChunk() {
        return null;
    },
};

registerVariant(rerankVariant);
