"use client"

import * as React from "react"
import { usePlaygroundStore, ModelConfig } from "@/lib/stores/playground-store"
import { useShallow } from "zustand/react/shallow"

export interface UseModelConfigsReturn {
    modelConfigs: Record<string, ModelConfig>
    getModelConfig: (modelId: string) => ModelConfig
    updateModelConfig: (modelId: string, config: ModelConfig) => void
    removeModelConfig: (modelId: string) => void
    buildConfigForModel: (modelId: string, globalHistoryLimit?: number) => Record<string, any>
}

// Empty object constant to avoid creating new references
const EMPTY_CONFIGS: Record<string, ModelConfig> = {}

/**
 * Hook to manage per-model configurations
 * Stores configs in the tab and provides helpers to build API configs
 */
export function useModelConfigs(tabId: string): UseModelConfigsReturn {
    const updateTab = usePlaygroundStore((state) => state.updateTab)

    // Get current tab's model configs
    const getTabConfigs = React.useCallback(() => {
        const tab = usePlaygroundStore.getState().tabs.find(t => t.id === tabId)
        return tab?.modelConfigs || EMPTY_CONFIGS
    }, [tabId])

    // Subscribe to model configs changes with shallow comparison
    const modelConfigs = usePlaygroundStore(
        useShallow((state) => {
            const tab = state.tabs.find(t => t.id === tabId)
            return tab?.modelConfigs || EMPTY_CONFIGS
        })
    )

    // Get config for a specific model
    const getModelConfig = React.useCallback((modelId: string): ModelConfig => {
        const configs = getTabConfigs()
        return configs[modelId] || {}
    }, [getTabConfigs])

    // Update config for a specific model
    const updateModelConfig = React.useCallback((modelId: string, config: ModelConfig) => {
        const currentConfigs = getTabConfigs()
        updateTab(tabId, {
            modelConfigs: {
                ...currentConfigs,
                [modelId]: config
            }
        })
    }, [tabId, updateTab, getTabConfigs])

    // Remove config for a model (when model is removed)
    const removeModelConfig = React.useCallback((modelId: string) => {
        const currentConfigs = getTabConfigs()
        const { [modelId]: _, ...rest } = currentConfigs
        updateTab(tabId, { modelConfigs: rest })
    }, [tabId, updateTab, getTabConfigs])

    // Build API config object for a specific model
    const buildConfigForModel = React.useCallback((
        modelId: string,
        globalHistoryLimit?: number
    ): Record<string, any> => {
        const config = getModelConfig(modelId)
        const result: Record<string, any> = {
            stream: true,
        }

        // Add history limit if provided
        if (globalHistoryLimit !== undefined) {
            result.conv_history_limit = globalHistoryLimit
        }

        // Add model-specific params if set
        if (config.temperature !== undefined) {
            result.temperature = config.temperature
        }
        if (config.maxTokens !== undefined) {
            result.max_tokens = config.maxTokens
        }
        if (config.topP !== undefined) {
            result.top_p = config.topP
        }
        if (config.frequencyPenalty !== undefined) {
            result.frequency_penalty = config.frequencyPenalty
        }
        if (config.presencePenalty !== undefined) {
            result.presence_penalty = config.presencePenalty
        }
        if (config.reasoningEffort) {
            result.reasoning_effort = config.reasoningEffort
        }

        return result
    }, [getModelConfig])

    return {
        modelConfigs,
        getModelConfig,
        updateModelConfig,
        removeModelConfig,
        buildConfigForModel
    }
}
