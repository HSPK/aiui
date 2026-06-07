import "server-only";
import { registerVariant, type UpstreamApiVariant } from ".";

export const audioSpeechVariant: UpstreamApiVariant = {
    id: "audio.speech",
    capability: "audio.speech",
    path: "/audio/speech",
    supportsStreaming: false,

    parseResponse() {
        // Audio responses are binary — the gateway intercepts at the
        // arraybuffer layer (see forwardGeneration) before calling this.
        return {
            output: "audio stream returned",
            promptTokens: null,
            completionTokens: null,
            totalTokens: null,
            normalized: {},
        };
    },

    parseStreamChunk() {
        return null;
    },
};

registerVariant(audioSpeechVariant);
