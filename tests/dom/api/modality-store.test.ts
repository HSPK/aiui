import { beforeEach, describe, expect, it, vi } from "vitest";

import {
    DEFAULT_IMAGE_PARAMS,
    DEFAULT_SPEECH_PARAMS,
    DEFAULT_TRANSCRIPTION_PARAMS,
    DEFAULT_VIDEO_PARAMS,
    entryPath,
    useModalityStore,
} from "@/lib/stores/modality-store";

const pristine = useModalityStore.getState();

function resetStore() {
    useModalityStore.setState(pristine, true);
    localStorage.clear();
}

describe("lib/stores/modality-store", () => {
    beforeEach(() => {
        resetStore();
    });

    describe("entryPath", () => {
        it("falls back to /playground/chat when lastPath is null", () => {
            expect(entryPath(null)).toBe("/playground/chat");
        });

        it("falls back to /playground/chat when lastPath is outside /playground/", () => {
            expect(entryPath("/settings")).toBe("/playground/chat");
            expect(entryPath("/")).toBe("/playground/chat");
        });

        it("returns the stored path (including query string) when it is a playground path", () => {
            expect(entryPath("/playground/image")).toBe("/playground/image");
            expect(entryPath("/playground/chat?c=abc123")).toBe("/playground/chat?c=abc123");
        });
    });

    describe("defaults", () => {
        it("initialises every slice to its documented defaults", () => {
            const s = useModalityStore.getState();
            expect(s.image).toEqual({ model: null, prompt: "", params: DEFAULT_IMAGE_PARAMS, result: null, error: null });
            expect(s.speech).toEqual({ model: null, text: "", params: DEFAULT_SPEECH_PARAMS, result: null, error: null });
            expect(s.transcription).toEqual({
                model: null,
                params: DEFAULT_TRANSCRIPTION_PARAMS,
                result: null,
                error: null,
            });
            expect(s.video).toEqual({ model: null, prompt: "", params: DEFAULT_VIDEO_PARAMS, job: null, error: null });
            expect(s.embedding).toEqual({ modelIds: [], query: "", docsText: "", params: {}, result: null, error: null });
            expect(s.lastPath).toBeNull();
            expect(s.modalityPaths).toEqual({});
            expect(s.navCollapsed).toBe(false);
            expect(s.chatHistoryOpen).toBe(false);
        });
    });

    describe("navigation state", () => {
        it("setLastPath overwrites the remembered playground entry point", () => {
            useModalityStore.getState().setLastPath("/playground/image?m=gpt-image-1");
            expect(useModalityStore.getState().lastPath).toBe("/playground/image?m=gpt-image-1");
        });

        it("setModalityPath accumulates per-modality paths without clobbering other modalities", () => {
            const store = useModalityStore.getState();
            store.setModalityPath("chat", "/playground/chat?c=1");
            store.setModalityPath("image", "/playground/image");
            store.setModalityPath("chat", "/playground/chat?c=2");

            expect(useModalityStore.getState().modalityPaths).toEqual({
                chat: "/playground/chat?c=2",
                image: "/playground/image",
            });
        });

        it("setNavCollapsed / toggleNav control the collapsed flag", () => {
            useModalityStore.getState().setNavCollapsed(true);
            expect(useModalityStore.getState().navCollapsed).toBe(true);
            useModalityStore.getState().toggleNav();
            expect(useModalityStore.getState().navCollapsed).toBe(false);
            useModalityStore.getState().toggleNav();
            expect(useModalityStore.getState().navCollapsed).toBe(true);
        });
    });

    describe("chatHistoryOpen (mobile sheet)", () => {
        it("setChatHistoryOpen sets an explicit boolean", () => {
            useModalityStore.getState().setChatHistoryOpen(true);
            expect(useModalityStore.getState().chatHistoryOpen).toBe(true);
            useModalityStore.getState().setChatHistoryOpen(false);
            expect(useModalityStore.getState().chatHistoryOpen).toBe(false);
        });
    });

    describe("per-slice patch/reset", () => {
        it("patchImage merges a partial patch and resetImage restores the default slice", () => {
            useModalityStore.getState().patchImage({ prompt: "a cat", model: "gpt-image-1" });
            expect(useModalityStore.getState().image).toMatchObject({ prompt: "a cat", model: "gpt-image-1" });

            useModalityStore.getState().resetImage();
            expect(useModalityStore.getState().image).toEqual({
                model: null,
                prompt: "",
                params: DEFAULT_IMAGE_PARAMS,
                result: null,
                error: null,
            });
        });

        it("patchSpeech merges a partial patch and resetSpeech restores the default slice", () => {
            useModalityStore.getState().patchSpeech({ text: "hello world", model: "tts-1" });
            expect(useModalityStore.getState().speech).toMatchObject({ text: "hello world", model: "tts-1" });

            useModalityStore.getState().resetSpeech();
            expect(useModalityStore.getState().speech).toEqual({
                model: null,
                text: "",
                params: DEFAULT_SPEECH_PARAMS,
                result: null,
                error: null,
            });
        });

        it("patchTranscription merges a partial patch and resetTranscription restores the default slice", () => {
            useModalityStore.getState().patchTranscription({ model: "whisper-1", error: "boom" });
            expect(useModalityStore.getState().transcription).toMatchObject({ model: "whisper-1", error: "boom" });

            useModalityStore.getState().resetTranscription();
            expect(useModalityStore.getState().transcription).toEqual({
                model: null,
                params: DEFAULT_TRANSCRIPTION_PARAMS,
                result: null,
                error: null,
            });
        });

        it("patchVideo merges a partial patch and resetVideo restores the default slice", () => {
            useModalityStore.getState().patchVideo({ prompt: "a dog running", model: "sora-2" });
            expect(useModalityStore.getState().video).toMatchObject({ prompt: "a dog running", model: "sora-2" });

            useModalityStore.getState().resetVideo();
            expect(useModalityStore.getState().video).toEqual({
                model: null,
                prompt: "",
                params: DEFAULT_VIDEO_PARAMS,
                job: null,
                error: null,
            });
        });

        it("patchEmbedding merges a partial patch and resetEmbedding restores the default slice", () => {
            useModalityStore.getState().patchEmbedding({ query: "search text", modelIds: ["text-embedding-3-small"] });
            expect(useModalityStore.getState().embedding).toMatchObject({
                query: "search text",
                modelIds: ["text-embedding-3-small"],
            });

            useModalityStore.getState().resetEmbedding();
            expect(useModalityStore.getState().embedding).toEqual({
                modelIds: [],
                query: "",
                docsText: "",
                params: {},
                result: null,
                error: null,
            });
        });
    });

    describe("persistence (partialize)", () => {
        it("strips large/volatile fields (result/job/error) from the persisted slices", () => {
            const store = useModalityStore.getState();
            store.patchImage({ prompt: "a cat", result: { data: [] } as never, error: "oops" });
            store.patchSpeech({ text: "hi", result: { url: "blob:x", format: "mp3", bytes: 1, elapsed_ms: 1 }, error: "oops" });
            store.patchTranscription({ result: "raw text" as never, error: "oops" });
            store.patchVideo({ prompt: "vid", job: { id: "job-1" } as never, error: "oops" });
            store.patchEmbedding({ query: "q", result: { data: [] } as never, error: "oops" });

            const raw = localStorage.getItem("loom-modality-state");
            expect(raw).not.toBeNull();
            const parsed = JSON.parse(raw as string);

            expect(parsed.state.image).toEqual({ model: null, prompt: "a cat", params: DEFAULT_IMAGE_PARAMS, result: null, error: null });
            expect(parsed.state.speech).toEqual({ model: null, text: "hi", params: DEFAULT_SPEECH_PARAMS, result: null, error: null });
            expect(parsed.state.transcription).toEqual({
                model: null,
                params: DEFAULT_TRANSCRIPTION_PARAMS,
                result: null,
                error: null,
            });
            expect(parsed.state.video).toEqual({ model: null, prompt: "vid", params: DEFAULT_VIDEO_PARAMS, job: null, error: null });
            expect(parsed.state.embedding).toEqual({ modelIds: [], query: "q", docsText: "", params: {}, result: null, error: null });
        });

        it("omits chatHistoryOpen entirely from the persisted payload (device-local only)", () => {
            useModalityStore.getState().setChatHistoryOpen(true);
            useModalityStore.getState().setLastPath("/playground/chat");

            const raw = localStorage.getItem("loom-modality-state");
            const parsed = JSON.parse(raw as string);
            expect(parsed.state).not.toHaveProperty("chatHistoryOpen");
            expect(Object.keys(parsed.state).sort()).toEqual(
                [
                    "embedding",
                    "image",
                    "lastPath",
                    "modalityPaths",
                    "navCollapsed",
                    "speech",
                    "transcription",
                    "video",
                ].sort(),
            );
        });

        it("a fresh module import rehydrates persisted navigation state but resets chatHistoryOpen to its default", async () => {
            useModalityStore.getState().setChatHistoryOpen(true); // never persisted
            useModalityStore.getState().setLastPath("/playground/image");
            useModalityStore.getState().setModalityPath("chat", "/playground/chat?c=42");
            useModalityStore.getState().setNavCollapsed(true);

            vi.resetModules();
            const { useModalityStore: freshStore } = await import("@/lib/stores/modality-store");
            const state = freshStore.getState();

            expect(state.lastPath).toBe("/playground/image");
            expect(state.modalityPaths).toEqual({ chat: "/playground/chat?c=42" });
            expect(state.navCollapsed).toBe(true);
            // Not part of partialize -> falls back to the slice default on reload.
            expect(state.chatHistoryOpen).toBe(false);
        });
    });
});
