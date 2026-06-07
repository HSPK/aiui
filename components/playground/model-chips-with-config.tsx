"use client"

import * as React from "react"
import { Settings2 } from "lucide-react"
import { useShallow } from "zustand/react/shallow"

import { models } from "@/lib/api"
import { usePlaygroundStore, type ModelConfig } from "@/lib/stores/playground-store"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"

import { ModelConfigPopover, DEFAULT_MODEL_CONFIG } from "./model-config-popover"

interface ModelChipsWithConfigProps {
    conversationId: string
    historyLimit: number
    onHistoryLimitChange: (value: number) => void
}

const EMPTY_MODEL_IDS: string[] = []
const EMPTY_CONFIGS: Record<string, ModelConfig> = {}

/** Selected models row — each chip opens a per-model config popover.
 *  Global settings popover holds history limit. */
export const ModelChipsWithConfig = React.memo(function ModelChipsWithConfig({
    conversationId,
    historyLimit,
    onHistoryLimitChange,
}: ModelChipsWithConfigProps) {
    const { data: modelsData } = models.useList(undefined, { staleTime: 5 * 60 * 1000 })

    const modelsMap = React.useMemo(() => {
        const map = new Map<string, { provider?: string }>()
        if (Array.isArray(modelsData)) {
            modelsData.forEach((m) => map.set(m.name, { provider: m.provider ?? undefined }))
        }
        return map
    }, [modelsData])

    const selectedModelIds = usePlaygroundStore(
        useShallow((state) => state.settings[conversationId]?.modelIds ?? EMPTY_MODEL_IDS)
    )

    const modelConfigs = usePlaygroundStore(
        useShallow((state) => state.settings[conversationId]?.modelConfigs ?? EMPTY_CONFIGS)
    )

    const updateSettings = usePlaygroundStore((s) => s.updateSettings)

    const handleConfigChange = React.useCallback(
        (modelId: string, config: ModelConfig) => {
            const current =
                usePlaygroundStore.getState().getSettings(conversationId).modelConfigs ?? {}
            updateSettings(conversationId, {
                modelConfigs: { ...current, [modelId]: config },
            })
        },
        [conversationId, updateSettings]
    )

    const handleRemoveModel = React.useCallback(
        (modelId: string) => {
            const settings = usePlaygroundStore.getState().getSettings(conversationId)
            const newModelIds = (settings.modelIds ?? []).filter((id) => id !== modelId)
            const restConfigs = { ...(settings.modelConfigs ?? {}) }
            delete restConfigs[modelId]
            updateSettings(conversationId, {
                modelIds: newModelIds,
                modelConfigs: restConfigs,
            })
        },
        [conversationId, updateSettings]
    )

    const [localHistory, setLocalHistory] = React.useState(historyLimit)
    const [historyOpen, setHistoryOpen] = React.useState(false)

    React.useEffect(() => {
        if (historyOpen) setLocalHistory(historyLimit)
    }, [historyOpen, historyLimit])

    if (selectedModelIds.length === 0) return null

    return (
        <div className="flex items-center gap-1.5 flex-wrap">
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
