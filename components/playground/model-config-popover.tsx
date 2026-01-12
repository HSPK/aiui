"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Settings2, X, RotateCcw } from "lucide-react"
import { ProviderIcon } from "@/components/provider-icons"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

// Per-model configuration type
export interface ModelConfig {
    temperature?: number
    maxTokens?: number
    topP?: number
    frequencyPenalty?: number
    presencePenalty?: number
    reasoningEffort?: "low" | "medium" | "high" | null
    // Extensible for future params
    [key: string]: any
}

// Default config for new models
export const DEFAULT_MODEL_CONFIG: ModelConfig = {
    temperature: undefined,
    maxTokens: undefined,
    topP: undefined,
    frequencyPenalty: undefined,
    presencePenalty: undefined,
    reasoningEffort: null,
}

interface ModelConfigPopoverProps {
    modelId: string
    provider?: string
    config: ModelConfig
    onConfigChange: (modelId: string, config: ModelConfig) => void
    onRemove?: (modelId: string) => void
    canRemove?: boolean
}

export const ModelConfigPopover = React.memo(function ModelConfigPopover({
    modelId,
    provider = "openai",
    config,
    onConfigChange,
    onRemove,
    canRemove = true,
}: ModelConfigPopoverProps) {
    const [open, setOpen] = React.useState(false)
    const [localConfig, setLocalConfig] = React.useState<ModelConfig>(config)

    // Sync local config when popover opens
    React.useEffect(() => {
        if (open) {
            setLocalConfig(config)
        }
    }, [open, config])

    const handleChange = React.useCallback(<K extends keyof ModelConfig>(
        key: K,
        value: ModelConfig[K]
    ) => {
        const newConfig = { ...localConfig, [key]: value }
        setLocalConfig(newConfig)
        onConfigChange(modelId, newConfig)
    }, [localConfig, modelId, onConfigChange])

    const handleReset = React.useCallback(() => {
        setLocalConfig(DEFAULT_MODEL_CONFIG)
        onConfigChange(modelId, DEFAULT_MODEL_CONFIG)
    }, [modelId, onConfigChange])

    // Check if any config is non-default
    const hasCustomConfig = React.useMemo(() => {
        return config.temperature !== undefined ||
            config.maxTokens !== undefined ||
            config.topP !== undefined ||
            config.frequencyPenalty !== undefined ||
            config.presencePenalty !== undefined ||
            config.reasoningEffort !== null
    }, [config])

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    className={cn(
                        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs transition-all",
                        "border hover:border-primary/50 group",
                        hasCustomConfig
                            ? "bg-primary/10 border-primary/30 text-primary"
                            : "bg-muted/50 border-transparent text-muted-foreground hover:text-foreground"
                    )}
                >
                    <ProviderIcon provider={provider} className="h-3.5 w-3.5" />
                    <span className="max-w-[120px] truncate">{modelId}</span>
                    {hasCustomConfig && (
                        <Settings2 className="h-3 w-3 text-primary" />
                    )}
                    {canRemove && onRemove && (
                        <X
                            className="h-3 w-3 opacity-0 group-hover:opacity-100 hover:text-destructive"
                            onClick={(e) => {
                                e.stopPropagation()
                                onRemove(modelId)
                            }}
                        />
                    )}
                </button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-0" align="start" side="top">
                <div className="border-b px-4 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <ProviderIcon provider={provider} className="h-4 w-4" />
                        <span className="font-medium text-sm truncate max-w-[180px]">{modelId}</span>
                    </div>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                        onClick={handleReset}
                    >
                        <RotateCcw className="h-3 w-3 mr-1" />
                        Reset
                    </Button>
                </div>

                <div className="p-4 space-y-4 max-h-[400px] overflow-y-auto">
                    {/* Temperature */}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <Label className="text-xs">Temperature</Label>
                            <span className="text-xs text-muted-foreground">
                                {localConfig.temperature ?? "Default"}
                            </span>
                        </div>
                        <div className="flex items-center gap-3">
                            <Slider
                                value={[localConfig.temperature ?? 1]}
                                onValueChange={([val]) => handleChange("temperature", val)}
                                min={0}
                                max={2}
                                step={0.1}
                                className="flex-1"
                            />
                            <Input
                                type="number"
                                min={0}
                                max={2}
                                step={0.1}
                                value={localConfig.temperature ?? ""}
                                onChange={(e) => handleChange("temperature", e.target.value ? parseFloat(e.target.value) : undefined)}
                                className="w-16 h-7 text-xs"
                                placeholder="Auto"
                            />
                        </div>
                    </div>

                    {/* Max Tokens */}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <Label className="text-xs">Max Tokens</Label>
                            <span className="text-xs text-muted-foreground">
                                {localConfig.maxTokens ?? "Default"}
                            </span>
                        </div>
                        <Input
                            type="number"
                            min={1}
                            max={128000}
                            value={localConfig.maxTokens ?? ""}
                            onChange={(e) => handleChange("maxTokens", e.target.value ? parseInt(e.target.value) : undefined)}
                            className="h-8 text-xs"
                            placeholder="Model default"
                        />
                    </div>

                    {/* Top P */}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <Label className="text-xs">Top P</Label>
                            <span className="text-xs text-muted-foreground">
                                {localConfig.topP ?? "Default"}
                            </span>
                        </div>
                        <div className="flex items-center gap-3">
                            <Slider
                                value={[localConfig.topP ?? 1]}
                                onValueChange={([val]) => handleChange("topP", val)}
                                min={0}
                                max={1}
                                step={0.05}
                                className="flex-1"
                            />
                            <Input
                                type="number"
                                min={0}
                                max={1}
                                step={0.05}
                                value={localConfig.topP ?? ""}
                                onChange={(e) => handleChange("topP", e.target.value ? parseFloat(e.target.value) : undefined)}
                                className="w-16 h-7 text-xs"
                                placeholder="Auto"
                            />
                        </div>
                    </div>

                    {/* Frequency Penalty */}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <Label className="text-xs">Frequency Penalty</Label>
                            <span className="text-xs text-muted-foreground">
                                {localConfig.frequencyPenalty ?? "Default"}
                            </span>
                        </div>
                        <div className="flex items-center gap-3">
                            <Slider
                                value={[localConfig.frequencyPenalty ?? 0]}
                                onValueChange={([val]) => handleChange("frequencyPenalty", val)}
                                min={-2}
                                max={2}
                                step={0.1}
                                className="flex-1"
                            />
                            <Input
                                type="number"
                                min={-2}
                                max={2}
                                step={0.1}
                                value={localConfig.frequencyPenalty ?? ""}
                                onChange={(e) => handleChange("frequencyPenalty", e.target.value ? parseFloat(e.target.value) : undefined)}
                                className="w-16 h-7 text-xs"
                                placeholder="0"
                            />
                        </div>
                    </div>

                    {/* Presence Penalty */}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <Label className="text-xs">Presence Penalty</Label>
                            <span className="text-xs text-muted-foreground">
                                {localConfig.presencePenalty ?? "Default"}
                            </span>
                        </div>
                        <div className="flex items-center gap-3">
                            <Slider
                                value={[localConfig.presencePenalty ?? 0]}
                                onValueChange={([val]) => handleChange("presencePenalty", val)}
                                min={-2}
                                max={2}
                                step={0.1}
                                className="flex-1"
                            />
                            <Input
                                type="number"
                                min={-2}
                                max={2}
                                step={0.1}
                                value={localConfig.presencePenalty ?? ""}
                                onChange={(e) => handleChange("presencePenalty", e.target.value ? parseFloat(e.target.value) : undefined)}
                                className="w-16 h-7 text-xs"
                                placeholder="0"
                            />
                        </div>
                    </div>

                    {/* Reasoning Effort (for o1/o3 models) */}
                    <div className="space-y-2">
                        <Label className="text-xs">Reasoning Effort</Label>
                        <Select
                            value={localConfig.reasoningEffort || "default"}
                            onValueChange={(val) => handleChange("reasoningEffort", val === "default" ? null : val as any)}
                        >
                            <SelectTrigger className="h-8 text-xs">
                                <SelectValue placeholder="Default" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="default">Default</SelectItem>
                                <SelectItem value="low">Low</SelectItem>
                                <SelectItem value="medium">Medium</SelectItem>
                                <SelectItem value="high">High</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    )
})
