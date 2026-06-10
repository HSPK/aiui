"use client"

import * as React from "react"
import * as ReactDOM from "react-dom"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Slider } from "@/components/ui/slider"
import { RotateCcw, X, ChevronDown } from "lucide-react"
import { ProviderIcon } from "@/components/ProviderIcon"
import { cn } from "@/lib/utils"
import {
    DEFAULT_MODEL_CONFIG,
    isEmptyConfig,
    type ModelConfig,
} from "@/lib/stores/playground-store"

// Re-export shared shape so callers keep their existing imports.
export { DEFAULT_MODEL_CONFIG, isEmptyConfig }
export type { ModelConfig }

interface ModelConfigPopoverProps {
    modelId: string
    provider?: string
    config: ModelConfig
    onConfigChange: (modelId: string, config: ModelConfig) => void
    onRemove?: (modelId: string) => void
    canRemove?: boolean
    /** Set when the saved modelId is no longer usable (deleted, admin
     *  disabled it, or capability changed). The chip renders with
     *  destructive styling + an (unavailable)/(missing) tag so the
     *  user knows their per-conv selection will 400 at the gateway —
     *  without this, the chip looks active while the dropdown
     *  silently excludes the model. */
    stale?: "missing" | "unavailable" | null
}

// Parameter row component - clean, toggle-style UI
const ParamRow = React.memo(function ParamRow({
    label,
    value,
    defaultValue,
    enabled,
    onToggle,
    onValueChange,
    min,
    max,
    step,
    showSlider = true,
}: {
    label: string
    value: number | undefined
    defaultValue: number
    enabled: boolean
    onToggle: () => void
    onValueChange: (val: number) => void
    min: number
    max: number
    step: number
    showSlider?: boolean
}) {
    const displayValue = value ?? defaultValue

    return (
        <div
            className={cn(
                "group rounded-lg transition-all",
                enabled ? "bg-accent/50" : "hover:bg-muted/50"
            )}
        >
            <div
                className="flex items-center justify-between px-3 py-2 cursor-pointer"
                onClick={onToggle}
            >
                <span className={cn(
                    "text-sm",
                    enabled ? "text-foreground font-medium" : "text-muted-foreground"
                )}>
                    {label}
                </span>
                <span className={cn(
                    "text-sm tabular-nums",
                    enabled ? "text-foreground" : "text-muted-foreground/60"
                )}>
                    {enabled ? displayValue : "Auto"}
                </span>
            </div>

            {enabled && showSlider && (
                <div className="px-3 pb-3 flex items-center gap-3">
                    <Slider
                        value={[displayValue]}
                        onValueChange={([val]) => onValueChange(val)}
                        min={min}
                        max={max}
                        step={step}
                        className="flex-1"
                    />
                    <Input
                        type="number"
                        min={min}
                        max={max}
                        step={step}
                        value={displayValue}
                        onChange={(e) => {
                            const v = parseFloat(e.target.value)
                            if (!isNaN(v) && v >= min && v <= max) {
                                onValueChange(v)
                            }
                        }}
                        className="w-16 h-7 text-xs text-center"
                    />
                </div>
            )}

            {enabled && !showSlider && (
                <div className="px-3 pb-3">
                    <Input
                        type="number"
                        min={min}
                        max={max}
                        step={step}
                        value={value ?? ""}
                        onChange={(e) => {
                            const v = parseInt(e.target.value)
                            if (!isNaN(v) && v >= min && v <= max) {
                                onValueChange(v)
                            }
                        }}
                        className="h-8 text-sm"
                        placeholder={`${min} - ${max}`}
                    />
                </div>
            )}
        </div>
    )
})

// Reasoning effort selector
const ReasoningRow = React.memo(function ReasoningRow({
    value,
    enabled,
    onToggle,
    onValueChange,
}: {
    value: "low" | "medium" | "high" | undefined
    enabled: boolean
    onToggle: () => void
    onValueChange: (val: "low" | "medium" | "high") => void
}) {
    return (
        <div
            className={cn(
                "group rounded-lg transition-all",
                enabled ? "bg-accent/50" : "hover:bg-muted/50"
            )}
        >
            <div
                className="flex items-center justify-between px-3 py-2 cursor-pointer"
                onClick={onToggle}
            >
                <span className={cn(
                    "text-sm",
                    enabled ? "text-foreground font-medium" : "text-muted-foreground"
                )}>
                    Reasoning Effort
                </span>
                <span className={cn(
                    "text-sm capitalize",
                    enabled ? "text-foreground" : "text-muted-foreground/60"
                )}>
                    {enabled ? value : "Auto"}
                </span>
            </div>

            {enabled && (
                <div className="px-3 pb-3 flex gap-1">
                    {(["low", "medium", "high"] as const).map((level) => (
                        <button
                            key={level}
                            type="button"
                            onClick={() => onValueChange(level)}
                            className={cn(
                                "flex-1 py-1.5 text-xs rounded-md transition-colors capitalize",
                                value === level
                                    ? "bg-primary text-primary-foreground"
                                    : "bg-muted hover:bg-muted/80 text-muted-foreground"
                            )}
                        >
                            {level}
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
})

export const ModelConfigPopover = React.memo(function ModelConfigPopover({
    modelId,
    provider = "openai",
    config,
    onConfigChange,
    onRemove,
    canRemove = true,
    stale = null,
}: ModelConfigPopoverProps) {
    const [open, setOpen] = React.useState(false)
    const [localConfig, setLocalConfig] = React.useState<ModelConfig>({})
    const triggerRef = React.useRef<HTMLButtonElement>(null)
    const popoverRef = React.useRef<HTMLDivElement>(null)
    const [position, setPosition] = React.useState<React.CSSProperties>({})

    // Sync local config when popover opens
    React.useEffect(() => {
        if (open) {
            setLocalConfig({ ...config })
        }
    }, [open, config])

    // Calculate position - returns style object
    const calculatePosition = React.useCallback((): React.CSSProperties => {
        if (!triggerRef.current) return {}

        const rect = triggerRef.current.getBoundingClientRect()
        const popoverWidth = 320
        const popoverHeight = 420
        const padding = 8

        const spaceAbove = rect.top
        const spaceBelow = window.innerHeight - rect.bottom
        const openAbove = spaceAbove >= popoverHeight || spaceAbove > spaceBelow

        let left = rect.left
        if (left + popoverWidth > window.innerWidth - padding) {
            left = Math.max(padding, rect.right - popoverWidth)
        }

        const style: React.CSSProperties = {
            position: 'fixed',
            width: popoverWidth,
            left,
            zIndex: 9999,
        }

        if (openAbove) {
            style.bottom = window.innerHeight - rect.top + padding
        } else {
            style.top = rect.bottom + padding
        }

        return style
    }, [])

    const updatePosition = React.useCallback(() => {
        setPosition(calculatePosition())
    }, [calculatePosition])

    // Handle open state change - calculate position before rendering
    const handleOpen = React.useCallback(() => {
        if (!open) {
            // Calculate position BEFORE setting open to avoid jitter
            setPosition(calculatePosition())
        }
        setOpen(!open)
    }, [open, calculatePosition])

    // Handle outside click and positioning
    React.useEffect(() => {
        if (!open) return

        updatePosition()

        const handleClickOutside = (e: MouseEvent) => {
            if (
                triggerRef.current && !triggerRef.current.contains(e.target as Node) &&
                popoverRef.current && !popoverRef.current.contains(e.target as Node)
            ) {
                setOpen(false)
            }
        }

        const handleScroll = () => updatePosition()
        const handleResize = () => updatePosition()

        document.addEventListener('mousedown', handleClickOutside)
        window.addEventListener('scroll', handleScroll, true)
        window.addEventListener('resize', handleResize)

        return () => {
            document.removeEventListener('mousedown', handleClickOutside)
            window.removeEventListener('scroll', handleScroll, true)
            window.removeEventListener('resize', handleResize)
        }
    }, [open, updatePosition])

    // Toggle a parameter on/off
    const toggleParam = React.useCallback(<K extends keyof ModelConfig>(
        key: K,
        defaultValue: ModelConfig[K]
    ) => {
        setLocalConfig(prev => {
            const newConfig = { ...prev }
            if (prev[key] === undefined) {
                newConfig[key] = defaultValue
            } else {
                delete newConfig[key]
            }
            onConfigChange(modelId, newConfig)
            return newConfig
        })
    }, [modelId, onConfigChange])

    // Update a parameter value
    const updateParam = React.useCallback(<K extends keyof ModelConfig>(
        key: K,
        value: ModelConfig[K]
    ) => {
        setLocalConfig(prev => {
            const newConfig = { ...prev, [key]: value }
            onConfigChange(modelId, newConfig)
            return newConfig
        })
    }, [modelId, onConfigChange])

    // Reset all params
    const handleReset = React.useCallback(() => {
        setLocalConfig({})
        onConfigChange(modelId, {})
    }, [modelId, onConfigChange])

    const hasCustomConfig = !isEmptyConfig(config)
    const enabledCount = Object.values(localConfig).filter(v => v !== undefined).length

    // Popover content rendered via Portal
    const popoverContent = open && (
        <div
            ref={popoverRef}
            style={position}
            className="rounded-xl border bg-popover text-popover-foreground shadow-xl animate-in fade-in-0 duration-100"
        >
            {/* Header */}
            <div className="border-b px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                    <ProviderIcon providerName={provider} className="h-4 w-4 shrink-0" />
                    <span className="font-medium text-sm truncate">{modelId}</span>
                    {enabledCount > 0 && (
                        <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">
                            {enabledCount}
                        </span>
                    )}
                </div>
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground shrink-0"
                    onClick={handleReset}
                    disabled={!hasCustomConfig}
                >
                    <RotateCcw className="h-3 w-3 mr-1" />
                    Reset
                </Button>
            </div>

            {/* Parameters - scrollable */}
            <div className="p-2 space-y-1 max-h-[360px] overflow-y-auto">
                <p className="text-[11px] text-muted-foreground px-3 py-1">
                    Click to enable/disable. Disabled = API default.
                </p>

                <ParamRow
                    label="Temperature"
                    value={localConfig.temperature}
                    defaultValue={1}
                    enabled={localConfig.temperature !== undefined}
                    onToggle={() => toggleParam("temperature", 1)}
                    onValueChange={(v) => updateParam("temperature", v)}
                    min={0}
                    max={2}
                    step={0.1}
                />

                <ParamRow
                    label="Max Tokens"
                    value={localConfig.maxTokens}
                    defaultValue={4096}
                    enabled={localConfig.maxTokens !== undefined}
                    onToggle={() => toggleParam("maxTokens", 4096)}
                    onValueChange={(v) => updateParam("maxTokens", v)}
                    min={1}
                    max={128000}
                    step={1}
                    showSlider={false}
                />

                <ParamRow
                    label="Top P"
                    value={localConfig.topP}
                    defaultValue={1}
                    enabled={localConfig.topP !== undefined}
                    onToggle={() => toggleParam("topP", 1)}
                    onValueChange={(v) => updateParam("topP", v)}
                    min={0}
                    max={1}
                    step={0.05}
                />

                <ParamRow
                    label="Frequency Penalty"
                    value={localConfig.frequencyPenalty}
                    defaultValue={0}
                    enabled={localConfig.frequencyPenalty !== undefined}
                    onToggle={() => toggleParam("frequencyPenalty", 0)}
                    onValueChange={(v) => updateParam("frequencyPenalty", v)}
                    min={-2}
                    max={2}
                    step={0.1}
                />

                <ParamRow
                    label="Presence Penalty"
                    value={localConfig.presencePenalty}
                    defaultValue={0}
                    enabled={localConfig.presencePenalty !== undefined}
                    onToggle={() => toggleParam("presencePenalty", 0)}
                    onValueChange={(v) => updateParam("presencePenalty", v)}
                    min={-2}
                    max={2}
                    step={0.1}
                />

                <ReasoningRow
                    value={localConfig.reasoningEffort}
                    enabled={localConfig.reasoningEffort !== undefined}
                    onToggle={() => toggleParam("reasoningEffort", "medium")}
                    onValueChange={(v) => updateParam("reasoningEffort", v)}
                />
            </div>
        </div>
    )

    return (
        <>
            <button
                ref={triggerRef}
                type="button"
                onClick={handleOpen}
                title={stale ? `${modelId} (${stale}) — remove and re-pick` : modelId}
                className={cn(
                    "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs transition-all",
                    "border group focus:outline-none focus:ring-1 focus:ring-ring focus:ring-offset-1",
                    stale
                        ? "bg-destructive/10 border-destructive/40 text-destructive hover:bg-destructive/15"
                        : hasCustomConfig
                            ? "bg-primary/10 border-primary/30 text-primary hover:bg-primary/20"
                            : "bg-muted/50 border-border/50 text-muted-foreground hover:text-foreground hover:border-border"
                )}
            >
                <ProviderIcon providerName={provider} className="h-3.5 w-3.5" />
                <span className={cn("max-w-[120px] truncate", stale && "line-through")}>{modelId}</span>
                {stale && (
                    <span className="text-[10px] shrink-0">({stale})</span>
                )}
                {!stale && hasCustomConfig && (
                    <span className="bg-primary text-primary-foreground text-[10px] px-1 rounded-sm font-medium">
                        {Object.values(config).filter(v => v !== undefined).length}
                    </span>
                )}
                <ChevronDown className={cn(
                    "h-3 w-3 transition-transform",
                    open && "rotate-180"
                )} />
                {canRemove && onRemove && (
                    <X
                        className="h-3 w-3 opacity-0 group-hover:opacity-100 hover:text-destructive ml-0.5"
                        onClick={(e) => {
                            e.stopPropagation()
                            onRemove(modelId)
                        }}
                    />
                )}
            </button>
            {typeof document !== 'undefined' && ReactDOM.createPortal(popoverContent, document.body)}
        </>
    )
})
