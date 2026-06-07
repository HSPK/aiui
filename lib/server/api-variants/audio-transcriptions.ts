import "server-only";
import { registerVariant, type UpstreamApiVariant } from ".";

export const audioTranscriptionsVariant: UpstreamApiVariant = {
    id: "audio.transcriptions",
    capability: "audio.transcription",
    path: "/audio/transcriptions",
    supportsStreaming: false,

    parseResponse(json) {
        const text = (json as { text?: string })?.text;
        return {
            output: typeof text === "string" ? text.slice(0, 400) : null,
            promptTokens: null,
            completionTokens: null,
            totalTokens: null,
            normalized: (json ?? {}) as Record<string, unknown>,
        };
    },

    parseStreamChunk() {
        return null;
    },
};

registerVariant(audioTranscriptionsVariant);
