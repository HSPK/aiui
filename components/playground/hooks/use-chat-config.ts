"use client"

import * as React from "react"
import { usePlaygroundStore } from "@/lib/stores/playground-store"
import { useSettingsStore } from "@/lib/stores/settings-store"

export interface ChatConfig {
    historyLimit: number
}

export interface ChatConfigCallbacks {
    onHistoryLimitChange: (val: number) => void
}

export interface UseChatConfigReturn {
    config: ChatConfig
    configRef: React.MutableRefObject<ChatConfig>
    callbacksRef: React.MutableRefObject<ChatConfigCallbacks>
    historyLimit: number
}

/**
 * Hook to manage global chat configuration (historyLimit)
 * Per-model configs (temperature, etc.) are now handled by useModelConfigs
 */
export function useChatConfig(tabId: string): UseChatConfigReturn {
    const updateTab = usePlaygroundStore((state) => state.updateTab)
    const settings = useSettingsStore()

    // Get initial values from tab or settings
    const getInitialTab = React.useCallback(() => {
        return usePlaygroundStore.getState().tabs.find(t => t.id === tabId)
    }, [tabId])

    const initialTab = getInitialTab()

    const [historyLimit, setHistoryLimit] = React.useState(
        initialTab?.historyLimit ?? settings.defaultHistoryLimit
    )

    // Config ref for ChatInput - prevents re-renders
    const configRef = React.useRef<ChatConfig>({ historyLimit })
    configRef.current = { historyLimit }

    // Callbacks ref for ChatInput - stable reference
    const callbacksRef = React.useRef<ChatConfigCallbacks>({
        onHistoryLimitChange: (val: number) => {
            setHistoryLimit(val)
            updateTab(tabId, { historyLimit: val })
        }
    })

    return {
        config: { historyLimit },
        configRef,
        callbacksRef,
        historyLimit
    }
}
