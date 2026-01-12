"use client"

import * as React from "react"
import { usePlaygroundStore } from "@/lib/stores/playground-store"
import { useSettingsStore } from "@/lib/stores/settings-store"

export interface ChatConfig {
    temperature: number | undefined
    historyLimit: number
    reasoningEffort: string | null
}

export interface ChatConfigCallbacks {
    onTemperatureChange: (val: number | undefined) => void
    onHistoryLimitChange: (val: number) => void
    onReasoningEffortChange: (val: string | null) => void
}

export interface UseChatConfigReturn {
    config: ChatConfig
    configRef: React.MutableRefObject<ChatConfig>
    callbacksRef: React.MutableRefObject<ChatConfigCallbacks>
    buildChatConfig: () => Record<string, any>
}

/**
 * Hook to manage chat configuration (temperature, historyLimit, reasoningEffort)
 * Provides stable refs for ChatInput to avoid re-renders
 */
export function useChatConfig(tabId: string): UseChatConfigReturn {
    const updateTab = usePlaygroundStore((state) => state.updateTab)
    const settings = useSettingsStore()

    // Get initial values from tab or settings
    const getInitialTab = React.useCallback(() => {
        return usePlaygroundStore.getState().tabs.find(t => t.id === tabId)
    }, [tabId])

    const initialTab = getInitialTab()

    const [temperature, setTemperature] = React.useState<number | undefined>(
        initialTab?.temperature ?? settings.defaultTemperature
    )
    const [historyLimit, setHistoryLimit] = React.useState(
        initialTab?.historyLimit ?? settings.defaultHistoryLimit
    )
    const [reasoningEffort, setReasoningEffort] = React.useState<string | null>(null)

    // Config ref for ChatInput - prevents re-renders
    const configRef = React.useRef<ChatConfig>({ temperature, historyLimit, reasoningEffort })
    configRef.current = { temperature, historyLimit, reasoningEffort }

    // Callbacks ref for ChatInput - stable reference
    const callbacksRef = React.useRef<ChatConfigCallbacks>({
        onTemperatureChange: (val: number | undefined) => {
            setTemperature(val)
            updateTab(tabId, { temperature: val })
        },
        onHistoryLimitChange: (val: number) => {
            setHistoryLimit(val)
            updateTab(tabId, { historyLimit: val })
        },
        onReasoningEffortChange: setReasoningEffort
    })

    // Build config object for API calls
    const buildChatConfig = React.useCallback(() => {
        const { temperature, historyLimit, reasoningEffort } = configRef.current
        const config: Record<string, any> = {
            stream: true,
            conv_history_limit: historyLimit
        }
        if (temperature !== undefined) config.temperature = temperature
        if (reasoningEffort) config.reasoning_effort = reasoningEffort
        return config
    }, [])

    return {
        config: { temperature, historyLimit, reasoningEffort },
        configRef,
        callbacksRef,
        buildChatConfig
    }
}
