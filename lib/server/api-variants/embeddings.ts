import "server-only";
import { extractUpstreamError, registerVariant, type UpstreamApiVariant } from ".";

export const embeddingsVariant: UpstreamApiVariant = {
    id: "embeddings",
    capability: "embedding",
    path: "/embeddings",
    supportsStreaming: false,

    parseResponse(json) {
        const j = json as {
            usage?: { prompt_tokens?: number; total_tokens?: number };
            data?: Array<{ embedding?: number[] }>;
        };
        const dim = j?.data?.[0]?.embedding?.length;
        return {
            output: dim ? `${j.data!.length} vector(s) × ${dim} dim` : null,
            promptTokens: j?.usage?.prompt_tokens ?? null,
            completionTokens: null,
            totalTokens: j?.usage?.total_tokens ?? null,
            normalized: (j ?? {}) as Record<string, unknown>,
            error: extractUpstreamError(j),
        };
    },

    parseStreamChunk() {
        return null;
    },
};

registerVariant(embeddingsVariant);
