"use client"

import * as React from "react"
import { usePlaygroundStore, type ModelConfig } from "@/lib/stores/playground-store"
import { useShallow } from "zustand/react/shallow"

export interface UseModelConfigsReturn {
    modelConfigs: Record<string, ModelConfig>
    getModelConfig: (modelId: string) => ModelConfig
    updateModelConfig: (modelId: string, config: ModelConfig) => void
    removeModelConfig: (modelId: string) => void
    buildConfigForModel: (modelId: string, globalHistoryLimit?: number) => Record<string, unknown>
}

const EMPTY_CONFIGS: Record<string, ModelConfig> = {}

/** Per-model configs keyed by conversationId in the playground store. */
export function useModelConfigs(conversationId: string): UseModelConfigsReturn {
    const updateSettings = usePlaygroundStore((s) => s.updateSettings)

    const modelConfigs = usePlaygroundStore(
        useShallow((state) => state.settings[conversationId]?.modelConfigs ?? EMPTY_CONFIGS)
    )

    const getCurrent = React.useCallback(
        () => usePlaygroundStore.getState().getSettings(conversationId).modelConfigs ?? EMPTY_CONFIGS,
        [conversationId]
    )

    const getModelConfig = React.useCallback(
        (modelId: string): ModelConfig => getCurrent()[modelId] ?? {},
        [getCurrent]
    )

    const updateModelConfig = React.useCallback(
        (modelId: string, config: ModelConfig) => {
            updateSettings(conversationId, {
                modelConfigs: { ...getCurrent(), [modelId]: config },
            })
        },
        [conversationId, updateSettings, getCurrent]
    )

    const removeModelConfig = React.useCallback(
        (modelId: string) => {
            const rest = { ...getCurrent() }
            delete rest[modelId]
            updateSettings(conversationId, { modelConfigs: rest })
        },
        [conversationId, updateSettings, getCurrent]
    )

    const buildConfigForModel = React.useCallback(
        (modelId: string, globalHistoryLimit?: number): Record<string, unknown> => {
            const config = getModelConfig(modelId)
            const result: Record<string, unknown> = { stream: true }
            if (globalHistoryLimit !== undefined) result.conv_history_limit = globalHistoryLimit
            if (config.temperature !== undefined) result.temperature = config.temperature
            if (config.maxTokens !== undefined) result.max_tokens = config.maxTokens
            if (config.topP !== undefined) result.top_p = config.topP
            if (config.frequencyPenalty !== undefined) result.frequency_penalty = config.frequencyPenalty
            if (config.presencePenalty !== undefined) result.presence_penalty = config.presencePenalty
            if (config.reasoningEffort) result.reasoning_effort = config.reasoningEffort
            return result
        },
        [getModelConfig]
    )

    return { modelConfigs, getModelConfig, updateModelConfig, removeModelConfig, buildConfigForModel }
}
