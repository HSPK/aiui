import { beforeEach, describe, expect, it, vi } from "vitest";

import {
    DEFAULT_MODEL_CONFIG,
    EMPTY_SETTINGS,
    isEmptyConfig,
    usePlaygroundStore,
    type ChatSettings,
    type ModelConfig,
} from "@/lib/stores/playground-store";

const pristine = usePlaygroundStore.getState();

function resetStore() {
    usePlaygroundStore.setState(pristine, true);
    localStorage.clear();
}

describe("lib/stores/playground-store", () => {
    beforeEach(() => {
        resetStore();
    });

    describe("isEmptyConfig", () => {
        it("is true for an entirely empty config", () => {
            expect(isEmptyConfig({})).toBe(true);
            expect(isEmptyConfig(DEFAULT_MODEL_CONFIG)).toBe(true);
        });

        it.each<[keyof ModelConfig, ModelConfig[keyof ModelConfig]]>([
            ["temperature", 0.5],
            ["maxTokens", 512],
            ["topP", 0.9],
            ["frequencyPenalty", 0.1],
            ["presencePenalty", 0.2],
            ["reasoningEffort", "high"],
        ])("is false when %s is set", (key, value) => {
            expect(isEmptyConfig({ [key]: value } as ModelConfig)).toBe(false);
        });

        it("is true when every field is explicitly undefined", () => {
            expect(
                isEmptyConfig({
                    temperature: undefined,
                    maxTokens: undefined,
                    topP: undefined,
                    frequencyPenalty: undefined,
                    presencePenalty: undefined,
                    reasoningEffort: undefined,
                }),
            ).toBe(true);
        });
    });

    it("EMPTY_SETTINGS is a frozen empty object", () => {
        expect(EMPTY_SETTINGS).toEqual({});
        expect(Object.isFrozen(EMPTY_SETTINGS)).toBe(true);
    });

    it("defaults to an empty settings map and an open history sidebar", () => {
        const state = usePlaygroundStore.getState();
        expect(state.settings).toEqual({});
        expect(state.isHistorySidebarOpen).toBe(true);
    });

    describe("getSettings / updateSettings", () => {
        it("getSettings returns EMPTY_SETTINGS for an unknown conversation id", () => {
            expect(usePlaygroundStore.getState().getSettings("conv-unknown")).toBe(EMPTY_SETTINGS);
        });

        it("updateSettings creates a fresh entry for a new conversation id", () => {
            usePlaygroundStore.getState().updateSettings("conv-1", { systemPrompt: "be nice" });
            const settings = usePlaygroundStore.getState().getSettings("conv-1");
            expect(settings).toEqual<ChatSettings>({ systemPrompt: "be nice" });
        });

        it("updateSettings merges a patch onto an existing entry without touching other ids", () => {
            const store = usePlaygroundStore.getState();
            store.updateSettings("conv-1", { systemPrompt: "be nice", historyLimit: 10 });
            store.updateSettings("conv-2", { systemPrompt: "other convo" });

            store.updateSettings("conv-1", { historyLimit: 20 });

            expect(usePlaygroundStore.getState().getSettings("conv-1")).toEqual<ChatSettings>({
                systemPrompt: "be nice",
                historyLimit: 20,
            });
            // conv-2 is untouched by the conv-1 update.
            expect(usePlaygroundStore.getState().getSettings("conv-2")).toEqual<ChatSettings>({
                systemPrompt: "other convo",
            });
        });

        it("removeSettings deletes only the targeted conversation id", () => {
            const store = usePlaygroundStore.getState();
            store.updateSettings("conv-1", { systemPrompt: "a" });
            store.updateSettings("conv-2", { systemPrompt: "b" });

            store.removeSettings("conv-1");

            expect(usePlaygroundStore.getState().settings).toEqual({ "conv-2": { systemPrompt: "b" } });
        });

        it("removeSettings is a no-op (returns the identical state) when the id is absent", () => {
            usePlaygroundStore.getState().updateSettings("conv-1", { systemPrompt: "a" });
            const stateBefore = usePlaygroundStore.getState();

            stateBefore.removeSettings("conv-does-not-exist");

            const stateAfter = usePlaygroundStore.getState();
            // No new object should have been created — same settings reference.
            expect(stateAfter.settings).toBe(stateBefore.settings);
        });
    });

    describe("history sidebar toggles", () => {
        it("toggleHistorySidebar flips the boolean", () => {
            expect(usePlaygroundStore.getState().isHistorySidebarOpen).toBe(true);
            usePlaygroundStore.getState().toggleHistorySidebar();
            expect(usePlaygroundStore.getState().isHistorySidebarOpen).toBe(false);
            usePlaygroundStore.getState().toggleHistorySidebar();
            expect(usePlaygroundStore.getState().isHistorySidebarOpen).toBe(true);
        });

        it("setHistorySidebarOpen sets an explicit value", () => {
            usePlaygroundStore.getState().setHistorySidebarOpen(false);
            expect(usePlaygroundStore.getState().isHistorySidebarOpen).toBe(false);
            usePlaygroundStore.getState().setHistorySidebarOpen(false);
            expect(usePlaygroundStore.getState().isHistorySidebarOpen).toBe(false);
        });
    });

    describe("persistence (partialize)", () => {
        it("persists exactly {settings, isHistorySidebarOpen} to localStorage", () => {
            usePlaygroundStore.getState().updateSettings("conv-1", { systemPrompt: "hi" });
            usePlaygroundStore.getState().setHistorySidebarOpen(false);

            const raw = localStorage.getItem("playground-storage");
            expect(raw).not.toBeNull();
            const parsed = JSON.parse(raw as string);
            expect(Object.keys(parsed.state).sort()).toEqual(["isHistorySidebarOpen", "settings"]);
            expect(parsed.state).toEqual({
                settings: { "conv-1": { systemPrompt: "hi" } },
                isHistorySidebarOpen: false,
            });
        });

        it("a fresh module import rehydrates persisted settings and sidebar state", async () => {
            localStorage.setItem(
                "playground-storage",
                JSON.stringify({
                    state: {
                        settings: { "conv-9": { systemPrompt: "restored" } },
                        isHistorySidebarOpen: false,
                    },
                    version: 0,
                }),
            );

            vi.resetModules();
            const { usePlaygroundStore: freshStore } = await import("@/lib/stores/playground-store");
            const state = freshStore.getState();
            expect(state.isHistorySidebarOpen).toBe(false);
            expect(state.getSettings("conv-9")).toEqual({ systemPrompt: "restored" });
        });
    });
});
