import { describe, expect, it } from "vitest";
import { audioSpeechVariant } from "@/lib/server/api-variants/audio-speech";
import type { VariantContext } from "@/lib/server/api-variants";
import { getCapability } from "@/lib/server/capabilities";
import "@/lib/server/capabilities/register";
import { makeModel, makeProvider } from "./fixtures";

const ctx: VariantContext = {
    provider: makeProvider(),
    model: makeModel({ type: "audio.speech" }),
    meta: null,
    capability: getCapability("audio.speech")!,
    stream: false,
};

describe("api-variants/audio-speech — descriptor", () => {
    it("declares the expected wire shape", () => {
        expect(audioSpeechVariant.id).toBe("audio.speech");
        expect(audioSpeechVariant.capability).toBe("audio.speech");
        expect(audioSpeechVariant.path).toBe("/audio/speech");
        expect(audioSpeechVariant.supportsStreaming).toBe(false);
        expect(audioSpeechVariant.transformRequest).toBeUndefined();
    });
});

describe("api-variants/audio-speech — parseResponse", () => {
    it("always reports a constant placeholder output regardless of the (binary-intercepted) json arg", () => {
        const result = audioSpeechVariant.parseResponse(undefined, ctx);
        expect(result.output).toBe("audio stream returned");
        expect(result.promptTokens).toBeNull();
        expect(result.completionTokens).toBeNull();
        expect(result.totalTokens).toBeNull();
        expect(result.normalized).toEqual({});
    });

    it("ignores whatever json is passed", () => {
        const result = audioSpeechVariant.parseResponse({ error: { message: "should be ignored" } }, ctx);
        expect(result.output).toBe("audio stream returned");
        expect(result.normalized).toEqual({});
    });
});

describe("api-variants/audio-speech — parseStreamChunk", () => {
    it("always returns null (non-streaming variant)", () => {
        expect(audioSpeechVariant.parseStreamChunk({}, ctx)).toBeNull();
    });
});
