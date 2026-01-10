import { create } from 'zustand';
import { Conversation, Message } from '@/lib/types/playground';

export type TabType = "chat" | "prompt" | "embedding" | "rerank" | "new";

export interface PlaygroundTab {
    id: string;
    type: TabType;
    title: string;
    conversationId?: string;
    modelId?: string; // Kept for legacy
    modelIds?: string[]; // Use this for Multi-Model Support
    systemPrompt?: string;
    temperature?: number;
    maxTokens?: number;
    historyLimit?: number; // Added
    messages: Message[]; // Initial messages if any
}

interface PlaygroundState {
    tabs: PlaygroundTab[];
    activeTabId: string | null;
    isSidebarOpen: boolean;

    addTab: (type?: TabType | (Partial<PlaygroundTab> & { type: TabType })) => void;
    removeTab: (id: string) => void;
    setActiveTab: (id: string) => void;
    updateTab: (id: string, updates: Partial<PlaygroundTab>) => void;
    toggleSidebar: () => void;
    setSidebarOpen: (open: boolean) => void;
}

export const usePlaygroundStore = create<PlaygroundState>((set) => ({
    tabs: [],
    activeTabId: null,
    isSidebarOpen: true,

    addTab: (input) => set((state) => {
        let tabConfig: Partial<PlaygroundTab> & { type: TabType };

        if (typeof input === "string") {
            tabConfig = { type: input };
        } else if (!input) {
            tabConfig = { type: "new", title: "New Tab" };
        } else {
            tabConfig = input;
        }

        const id = tabConfig.id || crypto.randomUUID();
        const newTab: PlaygroundTab = {
            id,
            title: tabConfig.title || "New Tab",
            messages: [],
            ...tabConfig,
        };
        // Ensure there's always one tab? Maybe not.
        return {
            tabs: [...state.tabs, newTab],
            activeTabId: id,
        };
    }),

    removeTab: (id) => set((state) => {
        const newTabs = state.tabs.filter((t) => t.id !== id);
        let newActiveId = state.activeTabId;

        if (state.activeTabId === id) {
            newActiveId = newTabs.length > 0 ? newTabs[newTabs.length - 1].id : null;
        }

        return {
            tabs: newTabs,
            activeTabId: newActiveId,
        };
    }),

    setActiveTab: (id) => set({ activeTabId: id }),

    updateTab: (id, updates) => set((state) => ({
        tabs: state.tabs.map((t) => (t.id === id ? { ...t, ...updates } : t)),
    })),

    toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
    setSidebarOpen: (open) => set({ isSidebarOpen: open }),
}));
