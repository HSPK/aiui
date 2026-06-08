import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export interface ModelConfig {
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    frequencyPenalty?: number;
    presencePenalty?: number;
    reasoningEffort?: "low" | "medium" | "high";
}

export const DEFAULT_MODEL_CONFIG: ModelConfig = {};

export function isEmptyConfig(config: ModelConfig): boolean {
    return (
        config.temperature === undefined &&
        config.maxTokens === undefined &&
        config.topP === undefined &&
        config.frequencyPenalty === undefined &&
        config.presencePenalty === undefined &&
        config.reasoningEffort === undefined
    );
}

export interface ChatSettings {
    modelIds?: string[];
    modelConfigs?: Record<string, ModelConfig>;
    systemPrompt?: string;
    historyLimit?: number;
    /** When true, the model picker is single-select: choosing a model
     *  replaces the current selection and closes the dropdown. When
     *  false (default), modelIds is a multi-select set. */
    singleModelMode?: boolean;
    /** Per-conversation MCP override (denylist). Empty / undefined
     *  means "every globally-enabled MCP server is active in this
     *  conversation"; ids in the list are excluded for this chat
     *  only. The popover Switches reflect `enabled && !disabled`. */
    disabledMcpServerIds?: string[];
}

export const EMPTY_SETTINGS: ChatSettings = Object.freeze({});

interface PlaygroundState {
    // Per-conversation settings, keyed by conversationId. Persisted to
    // localStorage so reopening a chat retains its model / config.
    settings: Record<string, ChatSettings>;

    // History sidebar collapsed state (device-local).
    isHistorySidebarOpen: boolean;

    getSettings: (conversationId: string) => ChatSettings;
    updateSettings: (conversationId: string, patch: Partial<ChatSettings>) => void;
    removeSettings: (conversationId: string) => void;

    toggleHistorySidebar: () => void;
    setHistorySidebarOpen: (open: boolean) => void;
}

export const usePlaygroundStore = create<PlaygroundState>()(
    persist(
        (set, get) => ({
            settings: {},
            isHistorySidebarOpen: true,

            getSettings: (id) => get().settings[id] ?? EMPTY_SETTINGS,

            updateSettings: (id, patch) =>
                set((state) => ({
                    settings: {
                        ...state.settings,
                        [id]: { ...(state.settings[id] ?? {}), ...patch },
                    },
                })),

            removeSettings: (id) =>
                set((state) => {
                    if (!(id in state.settings)) return state;
                    const next = { ...state.settings };
                    delete next[id];
                    return { settings: next };
                }),

            toggleHistorySidebar: () =>
                set((state) => ({ isHistorySidebarOpen: !state.isHistorySidebarOpen })),

            setHistorySidebarOpen: (open) => set({ isHistorySidebarOpen: open }),
        }),
        {
            name: "playground-storage",
            storage: createJSONStorage(() => localStorage),
            partialize: (state) => ({
                settings: state.settings,
                isHistorySidebarOpen: state.isHistorySidebarOpen,
            }),
        }
    )
);
