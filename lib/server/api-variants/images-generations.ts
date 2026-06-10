import "server-only";
import { extractUpstreamError, registerVariant, type UpstreamApiVariant } from ".";

export const imagesGenerationsVariant: UpstreamApiVariant = {
    id: "images.generations",
    capability: "image",
    path: "/images/generations",
    supportsStreaming: false,

    parseResponse(json) {
        const j = json as {
            data?: Array<{ url?: string; b64_json?: string }>;
            usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
        };
        const count = j?.data?.length ?? 0;
        return {
            output: count > 0 ? `Generated ${count} image${count === 1 ? "" : "s"}` : null,
            // gpt-image-1 reports token usage; legacy DALL·E doesn't.
            promptTokens: j?.usage?.input_tokens ?? null,
            completionTokens: j?.usage?.output_tokens ?? null,
            totalTokens: j?.usage?.total_tokens ?? null,
            normalized: (j ?? {}) as Record<string, unknown>,
            error: extractUpstreamError(j),
        };
    },

    parseStreamChunk() {
        return null;
    },
};

registerVariant(imagesGenerationsVariant);
