"use client"

import * as React from "react"
import { usePlaygroundStore } from "@/lib/stores/playground-store"
import { preferences } from "@/lib/api"

export interface ChatConfig {
    historyLimit: number
    systemPrompt: string
    singleModelMode: boolean
}

export interface ChatConfigCallbacks {
    onHistoryLimitChange: (val: number) => void
    onSystemPromptChange: (val: string) => void
    onSingleModelModeChange: (val: boolean) => void
}

export interface UseChatConfigReturn {
    config: ChatConfig
    configRef: React.MutableRefObject<ChatConfig>
    callbacksRef: React.MutableRefObject<ChatConfigCallbacks>
    historyLimit: number
    systemPrompt: string
    singleModelMode: boolean
}

/** Per-conversation chat config — history limit, system prompt, model
 *  picker single/multi mode. Falls back to user-preference defaults
 *  when a conversation hasn't overridden a field. Per-model params
 *  live in `useModelConfigs`. */
export function useChatConfig(conversationId: string): UseChatConfigReturn {
    const updateSettings = usePlaygroundStore((s) => s.updateSettings)
    const { data: userPrefs } = preferences.useGet()
    const defaultHistoryLimit = userPrefs?.default_history_limit ?? 10
    const defaultSystemPrompt = userPrefs?.default_system_prompt ?? ""

    const initial = usePlaygroundStore.getState().getSettings(conversationId)
    const [historyLimit, setHistoryLimit] = React.useState(
        initial.historyLimit ?? defaultHistoryLimit
    )
    const [systemPrompt, setSystemPrompt] = React.useState(
        initial.systemPrompt ?? defaultSystemPrompt
    )
    const [singleModelMode, setSingleModelMode] = React.useState(
        initial.singleModelMode ?? false
    )

    const configRef = React.useRef<ChatConfig>({ historyLimit, systemPrompt, singleModelMode })
    configRef.current = { historyLimit, systemPrompt, singleModelMode }

    const callbacksRef = React.useRef<ChatConfigCallbacks>({
        onHistoryLimitChange: (val: number) => {
            setHistoryLimit(val)
            updateSettings(conversationId, { historyLimit: val })
        },
        onSystemPromptChange: (val: string) => {
            setSystemPrompt(val)
            updateSettings(conversationId, { systemPrompt: val })
        },
        onSingleModelModeChange: (val: boolean) => {
            setSingleModelMode(val)
            const patch: Parameters<typeof updateSettings>[1] = { singleModelMode: val }
            // Flipping into single mode collapses any extra picks down to
            // one (keep the first; drops the rest) so we don't fan out
            // across N models on the next send.
            if (val) {
                const current =
                    usePlaygroundStore.getState().getSettings(conversationId).modelIds ?? []
                if (current.length > 1) patch.modelIds = [current[0]]
            }
            updateSettings(conversationId, patch)
        },
    })

    return {
        config: { historyLimit, systemPrompt, singleModelMode },
        configRef,
        callbacksRef,
        historyLimit,
        systemPrompt,
        singleModelMode,
    }
}
