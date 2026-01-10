import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

export interface UserSettings {
    // Model Settings
    defaultModel: string
    defaultSummaryModel: string

    // User Preferences
    userName: string
    userAvatar: string // emoji or URL

    // Chat Settings
    defaultSystemPrompt: string
    defaultTemperature: number
    defaultMaxTokens: number
    defaultHistoryLimit: number

    // UI Preferences
    sendOnEnter: boolean
    showTimestamps: boolean
    compactMode: boolean
}

interface SettingsState extends UserSettings {
    // Actions
    updateSettings: (updates: Partial<UserSettings>) => void
    resetSettings: () => void
}

const defaultSettings: UserSettings = {
    // Model Settings
    defaultModel: '',
    defaultSummaryModel: '',

    // User Preferences
    userName: 'User',
    userAvatar: '👤',

    // Chat Settings
    defaultSystemPrompt: 'You are a helpful assistant.',
    defaultTemperature: 0.7,
    defaultMaxTokens: 4096,
    defaultHistoryLimit: 10,

    // UI Preferences
    sendOnEnter: true,
    showTimestamps: true,
    compactMode: false,
}

export const useSettingsStore = create<SettingsState>()(
    persist(
        (set) => ({
            ...defaultSettings,

            updateSettings: (updates) => set((state) => ({
                ...state,
                ...updates,
            })),

            resetSettings: () => set(defaultSettings),
        }),
        {
            name: 'aiui-settings',
            storage: createJSONStorage(() => localStorage),
        }
    )
)
