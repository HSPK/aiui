"use client"

import { models } from "@/lib/api";
import * as React from "react"
import { Plus, Settings2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { usePlaygroundStore, ModelConfig } from "@/lib/stores/playground-store"
import { useShallow } from "zustand/react/shallow"

import { ModelConfigPopover, DEFAULT_MODEL_CONFIG } from "./model-config-popover"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

interface ModelChipsWithConfigProps {
    tabId: string
    historyLimit: number
    onHistoryLimitChange: (value: number) => void
}

// Empty constants to avoid creating new references
const EMPTY_MODEL_IDS: string[] = []
const EMPTY_CONFIGS: Record<string, ModelConfig> = {}

/**
 * Displays selected models as chips with per-model config popovers
 * Also includes a global history limit setting
 */
export const ModelChipsWithConfig = React.memo(function ModelChipsWithConfig({
    tabId,
    historyLimit,
    onHistoryLimitChange,
}: ModelChipsWithConfigProps) {
    // Get models data for provider info — 5min staleTime, the catalog is
    // small and refreshes via discovery cache on its own cadence.
    const { data: modelsData } = models.useList(undefined, { staleTime: 5 * 60 * 1000 })

    const modelsMap = React.useMemo(() => {
        const map = new Map<string, { provider?: string }>()
        if (Array.isArray(modelsData)) {
            modelsData.forEach(m => map.set(m.name, { provider: m.provider ?? undefined }))
        }
        return map
    }, [modelsData])

    // Subscribe to selected models with shallow comparison
    const selectedModelIds = usePlaygroundStore(
        useShallow((state) => {
            const tab = state.tabs.find(t => t.id === tabId)
            return tab?.modelIds || EMPTY_MODEL_IDS
        })
    )

    // Subscribe to model configs with shallow comparison
    const modelConfigs = usePlaygroundStore(
        useShallow((state) => {
            const tab = state.tabs.find(t => t.id === tabId)
            return tab?.modelConfigs || EMPTY_CONFIGS
        })
    )

    const updateTab = usePlaygroundStore((state) => state.updateTab)

    // Update config for a model
    const handleConfigChange = React.useCallback((modelId: string, config: ModelConfig) => {
        const currentConfigs = usePlaygroundStore.getState().tabs.find(t => t.id === tabId)?.modelConfigs || {}
        updateTab(tabId, {
            modelConfigs: {
                ...currentConfigs,
                [modelId]: config
            }
        })
    }, [tabId, updateTab])

    // Remove a model
    const handleRemoveModel = React.useCallback((modelId: string) => {
        const tab = usePlaygroundStore.getState().tabs.find(t => t.id === tabId)
        if (!tab) return

        const newModelIds = (tab.modelIds || []).filter(id => id !== modelId)
        const { [modelId]: _, ...restConfigs } = tab.modelConfigs || {}

        updateTab(tabId, {
            modelIds: newModelIds,
            modelConfigs: restConfigs
        })
    }, [tabId, updateTab])

    // Local state for history popover
    const [localHistory, setLocalHistory] = React.useState(historyLimit)
    const [historyOpen, setHistoryOpen] = React.useState(false)

    React.useEffect(() => {
        if (historyOpen) {
            setLocalHistory(historyLimit)
        }
    }, [historyOpen, historyLimit])

    if (selectedModelIds.length === 0) {
        return null
    }

    return (
        <div className="flex items-center gap-1.5 flex-wrap">
            {/* Model chips with config popovers */}
            {selectedModelIds.map((modelId) => (
                <ModelConfigPopover
                    key={modelId}
                    modelId={modelId}
                    provider={modelsMap.get(modelId)?.provider ?? undefined}
                    config={modelConfigs[modelId] || DEFAULT_MODEL_CONFIG}
                    onConfigChange={handleConfigChange}
                    onRemove={handleRemoveModel}
                    canRemove={selectedModelIds.length > 1}
                />
            ))}

            {/* Global settings button */}
            <Popover open={historyOpen} onOpenChange={setHistoryOpen}>
                <PopoverTrigger asChild>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground hover:text-foreground"
                    >
                        <Settings2 className="h-3.5 w-3.5" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-60 p-3" align="start" side="top">
                    <div className="space-y-3">
                        <h4 className="text-xs font-medium text-muted-foreground">Global Settings</h4>
                        <div className="space-y-2">
                            <Label className="text-xs">History Limit</Label>
                            <Input
                                type="number"
                                min={0}
                                max={100}
                                value={localHistory}
                                onChange={(e) => {
                                    const val = parseInt(e.target.value) || 0
                                    setLocalHistory(val)
                                    onHistoryLimitChange(val)
                                }}
                                className="h-8 text-xs"
                            />
                            <p className="text-[10px] text-muted-foreground">
                                Max messages to include in context
                            </p>
                        </div>
                    </div>
                </PopoverContent>
            </Popover>
        </div>
    )
})
