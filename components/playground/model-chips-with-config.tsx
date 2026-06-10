"use client"

import * as React from "react"
import { Settings2 } from "lucide-react"
import { useShallow } from "zustand/react/shallow"

import { models } from "@/lib/api/models"
import { preferences } from "@/lib/api/preferences"
import { defaultUserPreferences } from "@/lib/schemas/preferences"
import { usePlaygroundStore, type ModelConfig } from "@/lib/stores/playground-store"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"

import { ModelConfigPopover, DEFAULT_MODEL_CONFIG } from "./model-config-popover"

interface ModelChipsWithConfigProps {
    conversationId: string
}

const EMPTY_MODEL_IDS: string[] = []
const EMPTY_CONFIGS: Record<string, ModelConfig> = {}

/** Selected model chips + per-conversation settings popover
 *  (history limit, system prompt). Both fields fall through to user
 *  preferences when this conversation hasn't overridden them; the
 *  popover seeds its editor with the resolved value so users see what's
 *  actually in effect. */
export const ModelChipsWithConfig = React.memo(function ModelChipsWithConfig({
    conversationId,
}: ModelChipsWithConfigProps) {
    const { data: modelsData } = models.useList(undefined, { staleTime: 5 * 60 * 1000 })
    const { data: userPrefs } = preferences.useGet()
    const prefs = userPrefs ?? defaultUserPreferences

    const modelsMap = React.useMemo(() => {
        const map = new Map<string, { provider?: string; enabled?: boolean; type?: string }>()
        if (Array.isArray(modelsData)) {
            modelsData.forEach((m) => map.set(m.name, {
                provider: m.provider ?? undefined,
                enabled: m.enabled,
                type: m.type,
            }))
        }
        return map
    }, [modelsData])

    const selectedModelIds = usePlaygroundStore(
        useShallow((state) => state.settings[conversationId]?.modelIds ?? EMPTY_MODEL_IDS)
    )

    const modelConfigs = usePlaygroundStore(
        useShallow((state) => state.settings[conversationId]?.modelConfigs ?? EMPTY_CONFIGS)
    )

    // Read the per-conv overrides directly so the popover always reflects
    // current state; resolved values fall through to prefs.
    const convHistoryLimit = usePlaygroundStore(
        (s) => s.settings[conversationId]?.historyLimit,
    )
    const convSystemPrompt = usePlaygroundStore(
        (s) => s.settings[conversationId]?.systemPrompt,
    )
    const historyLimit = convHistoryLimit ?? prefs.default_history_limit
    const systemPrompt = convSystemPrompt ?? prefs.default_system_prompt

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

    // Buffered popover state — flushes to the store on blur so each
    // keystroke isn't a persist-write.
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
            {selectedModelIds.map((modelId) => {
                const entry = modelsMap.get(modelId)
                // Stale chip = saved model no longer present, disabled,
                // or no longer chat-capability. Without this cue the
                // chip looks active while the model dropdown silently
                // excludes it (R8 filter), so the user can't replace
                // via picker. Send will 400 at the gateway — surface
                // the unavailability up-front via the chip styling.
                const stale = !entry
                    ? "missing"
                    : (entry.enabled === false || (entry.type && entry.type !== "chat"))
                        ? "unavailable"
                        : null
                return (
                    <ModelConfigPopover
                        key={modelId}
                        modelId={modelId}
                        provider={entry?.provider ?? undefined}
                        config={modelConfigs[modelId] || DEFAULT_MODEL_CONFIG}
                        onConfigChange={handleConfigChange}
                        onRemove={handleRemoveModel}
                        canRemove={selectedModelIds.length > 1}
                        stale={stale}
                    />
                )
            })}

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
                        <div className="space-y-1.5">
                            <Label htmlFor="cs-history" className="text-xs">History limit</Label>
                            <Input
                                id="cs-history"
                                type="number"
                                min={1}
                                max={100}
                                value={localHistory}
                                onChange={(e) => setLocalHistory(parseInt(e.target.value) || 1)}
                                onBlur={() => updateSettings(conversationId, { historyLimit: localHistory })}
                                className="h-8 text-xs"
                            />
                        </div>

                        <div className="space-y-1.5">
                            <Label htmlFor="cs-system" className="text-xs">System prompt</Label>
                            <Textarea
                                id="cs-system"
                                value={localSystem}
                                onChange={(e) => setLocalSystem(e.target.value)}
                                onBlur={() => updateSettings(conversationId, { systemPrompt: localSystem })}
                                rows={5}
                                className="text-xs font-mono"
                            />
                        </div>
                    </div>
                </PopoverContent>
            </Popover>
        </div>
    )
})
