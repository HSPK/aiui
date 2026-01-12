"use client"

import * as React from "react"
import * as ReactDOM from "react-dom"
import { ChevronsUpDown, Search, X, Bot } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import { useSettingsStore } from "@/lib/stores/settings-store"
import { usePlaygroundStore } from "@/lib/stores/playground-store"
import { ProviderIcon } from "@/components/provider-icons"
import { useShallow } from "zustand/react/shallow"

// Simple model item - minimal DOM
const ModelItem = React.memo(({
    name,
    provider,
    isSelected,
    onToggle
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
        <span className={cn(
            "h-3.5 w-3.5 rounded-sm border flex items-center justify-center flex-shrink-0",
            isSelected ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground/30"
        )}>
            {isSelected && <span className="text-[10px]">✓</span>}
        </span>
        <ProviderIcon provider={provider} />
        <span className="truncate flex-1">{name}</span>
    </button>
), (prev, next) => {
    // Custom comparison - only re-render if these specific props change
    return prev.name === next.name &&
        prev.provider === next.provider &&
        prev.isSelected === next.isSelected &&
        prev.onToggle === next.onToggle
})
ModelItem.displayName = "ModelItem"

interface ModelSelectorProps {
    selectedModelIds: string[]
    onModelSelect: (ids: string[]) => void
    side?: 'top' | 'bottom' | 'left' | 'right'
    align?: 'start' | 'center' | 'end'
    trigger?: React.ReactNode
}

export function ModelSelector({ selectedModelIds, onModelSelect, side = "top", align = "start", trigger }: ModelSelectorProps) {
    const [open, setOpen] = React.useState(false)
    const [searchQuery, setSearchQuery] = React.useState("")
    const containerRef = React.useRef<HTMLDivElement>(null)
    const { defaultModel } = useSettingsStore()

    // Use refs to keep stable callback references
    const selectedIdsRef = React.useRef(selectedModelIds)
    const onModelSelectRef = React.useRef(onModelSelect)
    selectedIdsRef.current = selectedModelIds
    onModelSelectRef.current = onModelSelect

    const { data: modelsData, isLoading } = useQuery({
        queryKey: ["models"],
        queryFn: () => api.getModels(),
        staleTime: 5 * 60 * 1000,
        gcTime: 10 * 60 * 1000,
    })

    const models = React.useMemo(() => {
        const allModels = Array.isArray(modelsData) ? modelsData : []
        return allModels.filter(m => m.type === "chat")
    }, [modelsData])

    // Auto-select default model
    React.useEffect(() => {
        if (!isLoading && models.length > 0 && selectedModelIds.length === 0) {
            const userDefault = defaultModel || "gpt-3.5-turbo"
            const hasDefault = models.some(m => m.name === userDefault)
            onModelSelect([hasDefault ? userDefault : models[0].name])
        }
    }, [isLoading, models, selectedModelIds.length, onModelSelect, defaultModel])

    const filteredModels = React.useMemo(() => {
        if (!searchQuery) return models
        const q = searchQuery.toLowerCase()
        return models.filter(m => m.name.toLowerCase().includes(q))
    }, [models, searchQuery])

    // Close on click outside
    React.useEffect(() => {
        if (!open) return
        const handler = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setOpen(false)
            }
        }
        document.addEventListener('mousedown', handler)
        return () => document.removeEventListener('mousedown', handler)
    }, [open])

    React.useEffect(() => {
        if (!open) setSearchQuery("")
    }, [open])

    // Stable callback - no deps, reads from refs
    const handleToggle = React.useCallback((name: string) => {
        const currentIds = selectedIdsRef.current
        const isSelected = currentIds.includes(name)
        if (isSelected) {
            if (currentIds.length > 1) {
                onModelSelectRef.current(currentIds.filter(id => id !== name))
            }
        } else {
            onModelSelectRef.current([...currentIds, name])
        }
    }, [])

    // Convert to Set for O(1) lookup
    const selectedSet = React.useMemo(() => new Set(selectedModelIds), [selectedModelIds])

    const triggerLabel = selectedModelIds.length === 0
        ? "Select Model"
        : selectedModelIds.length === 1
            ? selectedModelIds[0]
            : `${selectedModelIds.length} models`

    // Calculate dropdown position
    const dropdownPosition = side === "top" ? "bottom-full mb-1" : "top-full mt-1"
    const dropdownAlign = align === "end" ? "right-0" : "left-0"

    return (
        <div ref={containerRef} className="relative">
            {trigger ? (
                <div onClick={() => !isLoading && setOpen(!open)}>
                    {trigger}
                </div>
            ) : (
                <Button
                    variant="outline"
                    className="w-[300px] justify-between"
                    disabled={isLoading}
                    onClick={() => setOpen(!open)}
                >
                    <span className="truncate">{triggerLabel}</span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
            )}
            {open && (
                <div className={cn(
                    "absolute z-50 w-[300px] rounded-md border bg-popover text-popover-foreground shadow-md",
                    dropdownPosition,
                    dropdownAlign
                )}>
                    <div className="p-2 border-b">
                        <div className="relative">
                            <Search className="absolute left-2 top-1.5 h-3.5 w-3.5 text-muted-foreground" />
                            <Input
                                placeholder="Search models..."
                                className="pl-7 h-7 text-xs"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                // No autofocus to avoid focusing on open
                            />
                        </div>
                        {selectedModelIds.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                                {selectedModelIds.map((id) => (
                                    <button
                                        key={id}
                                        onClick={() => handleToggle(id)}
                                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs hover:bg-primary/20"
                                    >
                                        <span className="truncate max-w-[100px]">{id}</span>
                                        <X className="h-3 w-3" />
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                    <div className="max-h-[280px] overflow-y-auto scrollbar-thin p-1">
                        {isLoading ? (
                            <div className="p-2 text-sm text-muted-foreground">Loading...</div>
                        ) : filteredModels.length === 0 ? (
                            <div className="p-2 text-sm text-muted-foreground">No models found</div>
                        ) : (
                            filteredModels.map((model) => (
                                <ModelItem
                                    key={model.name}
                                    name={model.name}
                                    provider={model.provider || "unknown"}
                                    isSelected={selectedSet.has(model.name)}
                                    onToggle={handleToggle}
                                />
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}

// Connected version that directly subscribes to store - prevents prop drilling
export function ConnectedModelSelector({ tabId }: { tabId: string }) {
    const [open, setOpen] = React.useState(false)
    const [searchQuery, setSearchQuery] = React.useState("")
    const triggerRef = React.useRef<HTMLButtonElement>(null)
    const dropdownRef = React.useRef<HTMLDivElement>(null)
    const [dropdownStyle, setDropdownStyle] = React.useState<React.CSSProperties>({})
    const { defaultModel } = useSettingsStore()

    // Direct store access - stable refs
    const storeRef = React.useRef(usePlaygroundStore)
    const updateTab = usePlaygroundStore((state) => state.updateTab)

    // Only subscribe to modelIds for badge count
    const modelCount = usePlaygroundStore(
        (state) => state.tabs.find(t => t.id === tabId)?.modelIds?.length || 0
    )

    const { data: modelsData, isLoading } = useQuery({
        queryKey: ["models"],
        queryFn: () => api.getModels(),
        staleTime: 5 * 60 * 1000,
        gcTime: 10 * 60 * 1000,
    })

    const models = React.useMemo(() => {
        const allModels = Array.isArray(modelsData) ? modelsData : []
        return allModels.filter(m => m.type === "chat")
    }, [modelsData])

    // Auto-select default model
    React.useEffect(() => {
        if (!isLoading && models.length > 0) {
            const currentIds = storeRef.current.getState().tabs.find(t => t.id === tabId)?.modelIds || []
            if (currentIds.length === 0) {
                const userDefault = defaultModel || "gpt-3.5-turbo"
                const hasDefault = models.some(m => m.name === userDefault)
                updateTab(tabId, { modelIds: [hasDefault ? userDefault : models[0].name] })
            }
        }
    }, [isLoading, models, defaultModel, tabId, updateTab])

    const filteredModels = React.useMemo(() => {
        if (!searchQuery) return models
        const q = searchQuery.toLowerCase()
        return models.filter(m => m.name.toLowerCase().includes(q))
    }, [models, searchQuery])

    // Calculate dropdown position when opening
    const updatePosition = React.useCallback(() => {
        if (!triggerRef.current) return

        const rect = triggerRef.current.getBoundingClientRect()
        const dropdownWidth = 320
        const dropdownHeight = 380 // Approximate max height
        const padding = 8

        // Calculate available space
        const spaceAbove = rect.top
        const spaceBelow = window.innerHeight - rect.bottom
        const spaceLeft = rect.left
        const spaceRight = window.innerWidth - rect.right

        // Prefer opening upward (above the input)
        const openAbove = spaceAbove >= dropdownHeight || spaceAbove > spaceBelow

        // Determine horizontal position - prefer left alignment, adjust if not enough space
        let left = rect.left
        if (left + dropdownWidth > window.innerWidth - padding) {
            left = Math.max(padding, rect.right - dropdownWidth)
        }

        const style: React.CSSProperties = {
            position: 'fixed',
            width: dropdownWidth,
            left,
            zIndex: 9999, // Very high z-index to ensure it's above everything
        }

        if (openAbove) {
            style.bottom = window.innerHeight - rect.top + padding
        } else {
            style.top = rect.bottom + padding
        }

        setDropdownStyle(style)
    }, [])

    // Close on click outside
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

        document.addEventListener('mousedown', handleClickOutside)
        window.addEventListener('scroll', handleScroll, true)
        window.addEventListener('resize', handleResize)

        return () => {
            document.removeEventListener('mousedown', handleClickOutside)
            window.removeEventListener('scroll', handleScroll, true)
            window.removeEventListener('resize', handleResize)
        }
    }, [open, updatePosition])

    React.useEffect(() => {
        if (!open) setSearchQuery("")
    }, [open])

    // Stable toggle - reads from store directly
    const handleToggle = React.useCallback((name: string) => {
        const currentIds = storeRef.current.getState().tabs.find(t => t.id === tabId)?.modelIds || []
        const isSelected = currentIds.includes(name)
        if (isSelected) {
            if (currentIds.length > 1) {
                updateTab(tabId, { modelIds: currentIds.filter(id => id !== name) })
            }
        } else {
            updateTab(tabId, { modelIds: [...currentIds, name] })
        }
    }, [tabId, updateTab])

    // Get selected for rendering - only when dropdown is open
    const selectedIds = open ? (storeRef.current.getState().tabs.find(t => t.id === tabId)?.modelIds || []) : []
    const selectedSet = React.useMemo(() => new Set(selectedIds), [selectedIds])

    // Render dropdown via Portal to avoid z-index/overflow issues
    const dropdownContent = open && (
        <div
            ref={dropdownRef}
            style={dropdownStyle}
            className="rounded-lg border bg-popover text-popover-foreground shadow-xl animate-in fade-in-0 zoom-in-95"
        >
            <div className="p-3 border-b">
                <div className="relative">
                    <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Search models..."
                        className="pl-8 h-8 text-sm"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                                // Do not auto-focus to avoid page flicker / scroll jump
                    />
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
                onClick={() => setOpen(!open)}
            >
                <Bot className="h-5 w-5" />
                {modelCount > 1 && (
                    <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground font-bold leading-none">
                        {modelCount}
                    </span>
                )}
            </Button>
            {typeof document !== 'undefined' && ReactDOM.createPortal(dropdownContent, document.body)}
        </>
    )
}

// Separate component to avoid re-rendering the whole dropdown
const SelectedModelTags = React.memo(({ ids, onRemove }: { ids: string[], onRemove: (id: string) => void }) => (
    <div className="flex flex-wrap gap-1 mt-2">
        {ids.map((id) => (
            <button
                key={id}
                onClick={() => onRemove(id)}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs hover:bg-primary/20"
            >
                <span className="truncate max-w-[100px]">{id}</span>
                <X className="h-3 w-3" />
            </button>
        ))}
    </div>
))
SelectedModelTags.displayName = "SelectedModelTags"

// Memoized model list
const ModelList = React.memo(({ models, selectedSet, isLoading, onToggle }: {
    models: any[]
    selectedSet: Set<string>
    isLoading: boolean
    onToggle: (name: string) => void
}) => (
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
))
ModelList.displayName = "ModelList"


