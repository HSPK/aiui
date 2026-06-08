"use client"

import * as React from "react"
import { Settings2 } from "lucide-react"
import { useShallow } from "zustand/react/shallow"

import { models } from "@/lib/api"
import { usePlaygroundStore, type ModelConfig } from "@/lib/stores/playground-store"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"

import { ModelConfigPopover, DEFAULT_MODEL_CONFIG } from "./model-config-popover"

interface ModelChipsWithConfigProps {
    conversationId: string
    historyLimit: number
    systemPrompt: string
    singleModelMode: boolean
    onHistoryLimitChange: (value: number) => void
    onSystemPromptChange: (value: string) => void
    onSingleModelModeChange: (value: boolean) => void
}

const EMPTY_MODEL_IDS: string[] = []
const EMPTY_CONFIGS: Record<string, ModelConfig> = {}

/** Selected model chips + global settings popover (history limit,
 *  system prompt, single-model toggle). */
export const ModelChipsWithConfig = React.memo(function ModelChipsWithConfig({
    conversationId,
    historyLimit,
    systemPrompt,
    singleModelMode,
    onHistoryLimitChange,
    onSystemPromptChange,
    onSingleModelModeChange,
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

    // Local state for the popover inputs so typing doesn't trigger a
    // store write on every keystroke. Flushed on blur / close.
    const [localHistory, setLocalHistory] = React.useState(historyLimit)
    const [localSystem, setLocalSystem] = React.useState(systemPrompt)
    const [popoverOpen, setPopoverOpen] = React.useState(false)

    React.useEffect(() => {
        if (popoverOpen) {
            setLocalHistory(historyLimit)
            setLocalSystem(systemPrompt)
        }
    }, [popoverOpen, historyLimit, systemPrompt])

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

            <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
                <PopoverTrigger asChild>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground hover:text-foreground"
                        title="Conversation settings"
                    >
                        <Settings2 className="h-3.5 w-3.5" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80 p-3" align="start" side="top">
                    <div className="space-y-4">
                        <div className="flex items-center justify-between gap-2">
                            <Label htmlFor="cs-single" className="text-xs">Single model</Label>
                            <Switch
                                id="cs-single"
                                checked={singleModelMode}
                                onCheckedChange={onSingleModelModeChange}
                            />
                        </div>

                        <div className="space-y-1.5">
                            <Label htmlFor="cs-history" className="text-xs">History limit</Label>
                            <Input
                                id="cs-history"
                                type="number"
                                min={1}
                                max={100}
                                value={localHistory}
                                onChange={(e) => setLocalHistory(parseInt(e.target.value) || 1)}
                                onBlur={() => onHistoryLimitChange(localHistory)}
                                className="h-8 text-xs"
                            />
                        </div>

                        <div className="space-y-1.5">
                            <Label htmlFor="cs-system" className="text-xs">System prompt</Label>
                            <Textarea
                                id="cs-system"
                                value={localSystem}
                                onChange={(e) => setLocalSystem(e.target.value)}
                                onBlur={() => onSystemPromptChange(localSystem)}
                                rows={5}
                                className="text-xs font-mono"
                                placeholder="(empty = use account default)"
                            />
                        </div>
                    </div>
                </PopoverContent>
            </Popover>
        </div>
    )
})
