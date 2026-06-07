"use client"

import * as React from "react"
import { usePlaygroundStore } from "@/lib/stores/playground-store"
import { preferences } from "@/lib/api"

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

/** Global chat config — currently just history limit. Per-model params
 *  live in `useModelConfigs`. */
export function useChatConfig(conversationId: string): UseChatConfigReturn {
    const updateSettings = usePlaygroundStore((s) => s.updateSettings)
    const { data: userPrefs } = preferences.useGet()
    const defaultHistoryLimit = userPrefs?.default_history_limit ?? 10

    const initial = usePlaygroundStore.getState().getSettings(conversationId)
    const [historyLimit, setHistoryLimit] = React.useState(
        initial.historyLimit ?? defaultHistoryLimit
    )

    const configRef = React.useRef<ChatConfig>({ historyLimit })
    configRef.current = { historyLimit }

    const callbacksRef = React.useRef<ChatConfigCallbacks>({
        onHistoryLimitChange: (val: number) => {
            setHistoryLimit(val)
            updateSettings(conversationId, { historyLimit: val })
        },
    })

    return { config: { historyLimit }, configRef, callbacksRef, historyLimit }
}
