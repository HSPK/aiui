"use client"

import * as React from "react"
import * as ReactDOM from "react-dom"
import { Layers, Search, Bot } from "lucide-react"

import { models } from "@/lib/api/models"
import { preferences } from "@/lib/api/preferences"
import { cn } from "@/lib/utils"
import { usePlaygroundStore } from "@/lib/stores/playground-store"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip"
import { ProviderIcon } from "@/components/ProviderIcon"

/** Stable empty-array reference — selectors must return identical
 *  values across renders for the React subscription to skip re-renders.
 *  `[] !== []`, so we share one frozen array. */
const EMPTY_MODELS: readonly string[] = Object.freeze<string[]>([])

const ModelItem = React.memo(
    ({
        name,
        provider,
        isSelected,
        onToggle,
    }: {
        name: string
        provider: string
        isSelected: boolean
        onToggle: (name: string) => void
    }) => (
        <button
            type="button"
            onClick={() => onToggle(name)}
            className={cn(
                "w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded-sm text-left transition-colors",
                isSelected ? "bg-accent text-accent-foreground" : "hover:bg-muted/50"
            )}
        >
            <span
                className={cn(
                    "h-3.5 w-3.5 rounded-sm border flex items-center justify-center flex-shrink-0",
                    isSelected
                        ? "bg-primary border-primary text-primary-foreground"
                        : "border-muted-foreground/30"
                )}
            >
                {isSelected && <span className="text-[10px]">✓</span>}
            </span>
            <ProviderIcon providerName={provider} />
            <span className="truncate flex-1">{name}</span>
        </button>
    ),
    (prev, next) =>
        prev.name === next.name &&
        prev.provider === next.provider &&
        prev.isSelected === next.isSelected &&
        prev.onToggle === next.onToggle
)
ModelItem.displayName = "ModelItem"

const ModelList = React.memo(function ModelList({
    models,
    selectedSet,
    isLoading,
    onToggle,
}: {
    models: Array<{ name: string; provider?: string | null }>
    selectedSet: Set<string>
    isLoading: boolean
    onToggle: (name: string) => void
}) {
    return (
        <div className="max-h-[280px] overflow-y-auto scrollbar-thin p-1">
            {isLoading ? (
                <div className="p-2 text-sm text-muted-foreground">Loading...</div>
            ) : models.length === 0 ? (
                <div className="p-2 text-sm text-muted-foreground">No models found</div>
            ) : (
                models.map((model) => (
                    <ModelItem
                        key={model.name}
                        name={model.name}
                        provider={model.provider || "unknown"}
                        isSelected={selectedSet.has(model.name)}
                        onToggle={onToggle}
                    />
                ))
            )}
        </div>
    )
})

export function ConnectedModelSelector({ conversationId }: { conversationId: string }) {
    const [open, setOpen] = React.useState(false)
    const [searchQuery, setSearchQuery] = React.useState("")
    const triggerRef = React.useRef<HTMLButtonElement>(null)
    const dropdownRef = React.useRef<HTMLDivElement>(null)
    const [dropdownStyle, setDropdownStyle] = React.useState<React.CSSProperties>({})

    const { data: userPrefs } = preferences.useGet()
    const defaultModel = userPrefs?.default_model ?? ""

    const updateSettings = usePlaygroundStore((s) => s.updateSettings)
    const modelCount = usePlaygroundStore(
        (s) => s.settings[conversationId]?.modelIds?.length ?? 0
    )
    const singleModelMode = usePlaygroundStore(
        (s) => s.settings[conversationId]?.singleModelMode ?? false
    )

    const { data: modelsData, isLoading } = models.useList(undefined, {
        staleTime: 5 * 60 * 1000,
        gcTime: 10 * 60 * 1000,
    })

    const chatModels = React.useMemo(() => {
        const all = Array.isArray(modelsData) ? modelsData : []
        return all.filter((m) => m.type === "chat")
    }, [modelsData])

    // Auto-select default model when none selected yet.
    React.useEffect(() => {
        if (isLoading || chatModels.length === 0) return
        const currentIds =
            usePlaygroundStore.getState().getSettings(conversationId).modelIds ?? []
        if (currentIds.length > 0) return
        const userDefault = defaultModel || "gpt-3.5-turbo"
        const hasDefault = chatModels.some((m) => m.name === userDefault)
        updateSettings(conversationId, {
            modelIds: [hasDefault ? userDefault : chatModels[0].name],
        })
    }, [isLoading, chatModels, defaultModel, conversationId, updateSettings])

    const filteredModels = React.useMemo(() => {
        if (!searchQuery) return chatModels
        const q = searchQuery.toLowerCase()
        return chatModels.filter((m) => m.name.toLowerCase().includes(q))
    }, [chatModels, searchQuery])

    const calculatePosition = React.useCallback((): React.CSSProperties => {
        if (!triggerRef.current) return {}
        const rect = triggerRef.current.getBoundingClientRect()
        const dropdownWidth = 320
        const dropdownHeight = 380
        const padding = 8

        const spaceAbove = rect.top
        const spaceBelow = window.innerHeight - rect.bottom
        const openAbove = spaceAbove >= dropdownHeight || spaceAbove > spaceBelow

        let left = rect.left
        if (left + dropdownWidth > window.innerWidth - padding) {
            left = Math.max(padding, rect.right - dropdownWidth)
        }

        const style: React.CSSProperties = {
            position: "fixed",
            width: dropdownWidth,
            left,
            zIndex: 9999,
        }
        if (openAbove) style.bottom = window.innerHeight - rect.top + padding
        else style.top = rect.bottom + padding
        return style
    }, [])

    const updatePosition = React.useCallback(() => {
        setDropdownStyle(calculatePosition())
    }, [calculatePosition])

    const handleOpen = React.useCallback(() => {
        if (!open) setDropdownStyle(calculatePosition())
        setOpen(!open)
    }, [open, calculatePosition])

    React.useEffect(() => {
        if (!open) return
        updatePosition()
        const handleClickOutside = (e: MouseEvent) => {
            if (
                triggerRef.current && !triggerRef.current.contains(e.target as Node) &&
                dropdownRef.current && !dropdownRef.current.contains(e.target as Node)
            ) {
                setOpen(false)
            }
        }
        const handleScroll = () => updatePosition()
        const handleResize = () => updatePosition()
        document.addEventListener("mousedown", handleClickOutside)
        window.addEventListener("scroll", handleScroll, true)
        window.addEventListener("resize", handleResize)
        return () => {
            document.removeEventListener("mousedown", handleClickOutside)
            window.removeEventListener("scroll", handleScroll, true)
            window.removeEventListener("resize", handleResize)
        }
    }, [open, updatePosition])

    React.useEffect(() => {
        if (!open) setSearchQuery("")
    }, [open])

    const handleToggle = React.useCallback(
        (name: string) => {
            const current =
                usePlaygroundStore.getState().getSettings(conversationId).modelIds ?? []
            // Single-model mode: any pick replaces the selection with
            // just that one model and closes the dropdown.
            if (singleModelMode) {
                updateSettings(conversationId, { modelIds: [name] })
                setOpen(false)
                return
            }
            const isSelected = current.includes(name)
            if (isSelected) {
                if (current.length > 1) {
                    updateSettings(conversationId, { modelIds: current.filter((id) => id !== name) })
                }
            } else {
                updateSettings(conversationId, { modelIds: [...current, name] })
            }
        },
        [conversationId, updateSettings, singleModelMode]
    )

    // Subscribe to the conversation's settings so the dropdown's
    // checkmarks stay live when the user changes models elsewhere
    // (e.g. via the chips above). Using getState() here would freeze
    // the value at first render.
    const settingsModelIds = usePlaygroundStore(
        (s) => s.settings[conversationId]?.modelIds ?? EMPTY_MODELS,
    )
    const selectedIds = open ? settingsModelIds : EMPTY_MODELS
    const selectedSet = React.useMemo(() => new Set(selectedIds), [selectedIds])

    const handleToggleSingleMode = React.useCallback(() => {
        const next = !singleModelMode
        const patch: Parameters<typeof updateSettings>[1] = { singleModelMode: next }
        // Flipping into single-mode collapses any extra picks down to
        // the first so the next send doesn't fan out unexpectedly.
        if (next) {
            const current = usePlaygroundStore.getState().getSettings(conversationId).modelIds ?? []
            if (current.length > 1) patch.modelIds = [current[0]]
        }
        updateSettings(conversationId, patch)
    }, [conversationId, singleModelMode, updateSettings])

    const dropdownContent = open && (
        <div
            ref={dropdownRef}
            style={dropdownStyle}
            className="rounded-lg border bg-popover text-popover-foreground shadow-xl animate-in fade-in-0 duration-100"
        >
            <div className="p-3 border-b">
                <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                        <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Search models..."
                            className="pl-8 h-8 text-sm"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>
                    <TooltipProvider delayDuration={300}>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    type="button"
                                    variant={singleModelMode ? "default" : "ghost"}
                                    size="icon"
                                    className="h-8 w-8 shrink-0"
                                    onClick={handleToggleSingleMode}
                                    aria-pressed={singleModelMode}
                                >
                                    <Layers className="h-4 w-4" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom">
                                {singleModelMode ? "Single model" : "Multi-model"}
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>
            </div>
            <ModelList
                models={filteredModels}
                selectedSet={selectedSet}
                isLoading={isLoading}
                onToggle={handleToggle}
            />
        </div>
    )

    return (
        <>
            <Button
                ref={triggerRef}
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground relative"
                disabled={isLoading}
                onClick={handleOpen}
            >
                <Bot className="h-5 w-5" />
                {modelCount > 1 && (
                    <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground font-bold leading-none">
                        {modelCount}
                    </span>
                )}
            </Button>
            {typeof document !== "undefined" && ReactDOM.createPortal(dropdownContent, document.body)}
        </>
    )
}
