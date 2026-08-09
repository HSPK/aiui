import { describe, expect, it } from "vitest";
import { audioTranscriptionsVariant } from "@/lib/server/api-variants/audio-transcriptions";
import type { VariantContext } from "@/lib/server/api-variants";
import { getCapability } from "@/lib/server/capabilities";
import "@/lib/server/capabilities/register";
import { makeModel, makeProvider } from "./fixtures";

const ctx: VariantContext = {
    provider: makeProvider(),
    model: makeModel({ type: "audio.transcription" }),
    meta: null,
    capability: getCapability("audio.transcription")!,
    stream: false,
};

describe("api-variants/audio-transcriptions — descriptor", () => {
    it("declares the expected wire shape", () => {
        expect(audioTranscriptionsVariant.id).toBe("audio.transcriptions");
        expect(audioTranscriptionsVariant.capability).toBe("audio.transcription");
        expect(audioTranscriptionsVariant.path).toBe("/audio/transcriptions");
        expect(audioTranscriptionsVariant.supportsStreaming).toBe(false);
    });
});

describe("api-variants/audio-transcriptions — parseResponse", () => {
    it("returns the transcript text verbatim when short", () => {
        const json = { text: "the quick brown fox" };
        const result = audioTranscriptionsVariant.parseResponse(json, ctx);
        expect(result.output).toBe("the quick brown fox");
        expect(result.normalized).toBe(json);
        expect(result.promptTokens).toBeNull();
    });

    it("truncates a long transcript to 400 characters", () => {
        const result = audioTranscriptionsVariant.parseResponse({ text: "x".repeat(1000) }, ctx);
        expect(result.output).toHaveLength(400);
    });

    it("returns null output when text is missing or not a string", () => {
        expect(audioTranscriptionsVariant.parseResponse({}, ctx).output).toBeNull();
        expect(audioTranscriptionsVariant.parseResponse({ text: 42 }, ctx).output).toBeNull();
    });

    it("handles a null json body without throwing, defaulting normalized to {}", () => {
        const result = audioTranscriptionsVariant.parseResponse(null, ctx);
        expect(result.output).toBeNull();
        expect(result.normalized).toEqual({});
    });

    it("surfaces a 200-with-error envelope", () => {
        const result = audioTranscriptionsVariant.parseResponse({ error: { message: "unsupported audio format" } }, ctx);
        expect(result.error).toBe("unsupported audio format");
    });
});

describe("api-variants/audio-transcriptions — parseStreamChunk", () => {
    it("always returns null (non-streaming variant)", () => {
        expect(audioTranscriptionsVariant.parseStreamChunk({}, ctx)).toBeNull();
    });
});
