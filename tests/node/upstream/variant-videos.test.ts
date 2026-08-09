import { describe, expect, it } from "vitest";
import { videosVariant } from "@/lib/server/api-variants/videos";
import type { VariantContext } from "@/lib/server/api-variants";
import { getCapability } from "@/lib/server/capabilities";
import "@/lib/server/capabilities/register";
import { makeModel, makeProvider } from "./fixtures";

const ctx: VariantContext = {
    provider: makeProvider(),
    model: makeModel({ type: "video" }),
    meta: null,
    capability: getCapability("video")!,
    stream: false,
};

describe("api-variants/videos — descriptor", () => {
    it("declares the expected wire shape", () => {
        expect(videosVariant.id).toBe("videos");
        expect(videosVariant.capability).toBe("video");
        expect(videosVariant.path).toBe("/videos");
        expect(videosVariant.supportsStreaming).toBe(false);
        expect(videosVariant.transformRequest).toBeUndefined();
    });
});

describe("api-variants/videos — parseResponse: summary formatting", () => {
    it("summarizes id + status together", () => {
        const result = videosVariant.parseResponse({ id: "video_123", status: "queued" }, ctx);
        expect(result.output).toBe("video_123 (queued)");
    });

    it("summarizes id alone when status is absent", () => {
        const result = videosVariant.parseResponse({ id: "video_123" }, ctx);
        expect(result.output).toBe("video_123");
    });

    it("summarizes status alone when id is absent", () => {
        const result = videosVariant.parseResponse({ status: "processing" }, ctx);
        expect(result.output).toBe("processing");
    });

    it("falls back to a generic marker when both id and status are absent", () => {
        expect(videosVariant.parseResponse({}, ctx).output).toBe("video job created");
        expect(videosVariant.parseResponse(null, ctx).output).toBe("video job created");
    });

    it("has null token usage (video generation has no token accounting here)", () => {
        const result = videosVariant.parseResponse({ id: "v1", status: "completed" }, ctx);
        expect(result.promptTokens).toBeNull();
        expect(result.completionTokens).toBeNull();
        expect(result.totalTokens).toBeNull();
    });

    it("preserves the raw json as normalized, defaulting to {} for a null body", () => {
        const json = { id: "v1", status: "completed", size: "1024x1024" };
        expect(videosVariant.parseResponse(json, ctx).normalized).toBe(json);
        expect(videosVariant.parseResponse(null, ctx).normalized).toEqual({});
    });
});

describe("api-variants/videos — parseResponse: error surfacing", () => {
    it("surfaces a standard {error:{message}} envelope regardless of status", () => {
        const result = videosVariant.parseResponse({ id: "v1", status: "queued", error: { message: "quota exceeded" } }, ctx);
        expect(result.error).toBe("quota exceeded");
    });

    it("defaults to a generic 'video job failed' marker when status:failed carries no error envelope", () => {
        const result = videosVariant.parseResponse({ id: "v1", status: "failed" }, ctx);
        expect(result.error).toBe("video job failed");
    });

    it("still defaults to the generic marker when status:failed and `error` is a non-object, non-string value", () => {
        const result = videosVariant.parseResponse({ id: "v1", status: "failed", error: 42 as unknown as string }, ctx);
        expect(result.error).toBe("video job failed");
    });

    it("has no error for a non-failed status with no error envelope", () => {
        expect(videosVariant.parseResponse({ id: "v1", status: "completed" }, ctx).error).toBeUndefined();
        expect(videosVariant.parseResponse({ id: "v1", status: "in_progress" }, ctx).error).toBeUndefined();
    });
});

describe("api-variants/videos — parseStreamChunk", () => {
    it("always returns null (async create + poll, not SSE)", () => {
        expect(videosVariant.parseStreamChunk({}, ctx)).toBeNull();
    });
});
