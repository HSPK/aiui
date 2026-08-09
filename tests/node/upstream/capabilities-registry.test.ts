import { describe, expect, it } from "vitest";
import "@/lib/server/capabilities/register";
import {
    DEFAULT_CAPABILITY_ID,
    classifyModel,
    getCapability,
    listCapabilities,
    registerCapability,
} from "@/lib/server/capabilities";

describe("capabilities/index — getCapability / listCapabilities", () => {
    it("every built-in capability is registered under its own id", () => {
        for (const id of ["chat", "embedding", "image", "audio.speech", "audio.transcription", "rerank", "video"]) {
            expect(getCapability(id)?.id).toBe(id);
        }
    });

    it("returns undefined for an unregistered id", () => {
        expect(getCapability("nonexistent-capability")).toBeUndefined();
    });

    it("listCapabilities is sorted by priority, descending", () => {
        const list = listCapabilities();
        for (let i = 1; i < list.length; i++) {
            expect(list[i - 1].priority ?? 0).toBeGreaterThanOrEqual(list[i].priority ?? 0);
        }
        // Sanity: every built-in id shows up exactly once.
        const ids = list.map((c) => c.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids).toEqual(expect.arrayContaining(["chat", "embedding", "image", "rerank", "video"]));
    });
});

describe("capabilities/index — registerCapability", () => {
    it("throws when handler.id is falsy", () => {
        expect(() => registerCapability({ id: "", label: "x", defaultVariantId: "chat.completions" }))
            .toThrow(/capability\.id is required/);
    });

    it("registering the same id twice overwrites — last write wins", () => {
        registerCapability({ id: "test-cap-overwrite", label: "first", defaultVariantId: "chat.completions" });
        registerCapability({ id: "test-cap-overwrite", label: "second", defaultVariantId: "chat.completions" });
        expect(getCapability("test-cap-overwrite")?.label).toBe("second");
    });

    it("listCapabilities defaults a missing priority to 0 when sorting (documented default)", () => {
        registerCapability({ id: "test-cap-no-priority", label: "no priority", defaultVariantId: "chat.completions" });
        registerCapability({ id: "test-cap-negative-priority", label: "negative priority", defaultVariantId: "chat.completions", priority: -5 });
        const list = listCapabilities();
        const noPriorityIdx = list.findIndex((c) => c.id === "test-cap-no-priority");
        const negativePriorityIdx = list.findIndex((c) => c.id === "test-cap-negative-priority");
        // undefined defaults to 0, which outranks an explicit negative priority.
        expect(noPriorityIdx).toBeLessThan(negativePriorityIdx);
    });
});

describe("capabilities/index — classifyModel (real built-in regexes)", () => {
    it.each([
        ["gpt-4o-mini", "chat"],
        ["chatgpt-4o-latest", "chat"],
        ["o1-preview", "chat"],
        ["claude-3-5-sonnet", "chat"],
        ["gemini-1.5-pro", "chat"],
        ["llama-3-70b", "chat"],
        ["some-custom-model-instruct", "chat"],
        ["text-embedding-3-small", "embedding"],
        ["bge-large-en", "embedding"],
        ["dall-e-3", "image"],
        ["stable-diffusion-xl", "image"],
        ["tts-1", "audio.speech"],
        ["elevenlabs-v2", "audio.speech"],
        ["whisper-1", "audio.transcription"],
        ["paraformer-zh", "audio.transcription"],
        ["bge-reranker-large", "rerank"],
        ["cohere-rerank-v3", "rerank"],
        ["sora-2", "video"],
        // Priority ordering: "video" (priority 30) is checked before "chat" (priority
        // 10), so a model whose id both starts with a chat-recognised vendor prefix
        // AND contains a video-specific token classifies as "video".
        ["hunyuan-video", "video"],
        ["totally-unrecognized-model-id-xyz", "chat"], // DEFAULT_CAPABILITY_ID fallback
    ])("classifies %s as %s", (id, expected) => {
        expect(classifyModel(id)).toBe(expected);
    });

    it("DEFAULT_CAPABILITY_ID is 'chat'", () => {
        expect(DEFAULT_CAPABILITY_ID).toBe("chat");
    });

    it("a higher-priority custom capability is checked before lower-priority built-ins", () => {
        registerCapability({
            id: "test-cap-priority",
            label: "test",
            defaultVariantId: "chat.completions",
            priority: 1000,
            matches: (id) => id === "distinctive-test-model-id-9000",
        });
        expect(classifyModel("distinctive-test-model-id-9000")).toBe("test-cap-priority");
        // Unrelated ids are unaffected.
        expect(classifyModel("gpt-4o")).toBe("chat");
    });

    it("capabilities without a matches() function are simply skipped, never throwing", () => {
        registerCapability({ id: "test-cap-no-matches", label: "test", defaultVariantId: "chat.completions", priority: 2000 });
        expect(() => classifyModel("gpt-4o")).not.toThrow();
        expect(classifyModel("gpt-4o")).toBe("chat");
    });
});
