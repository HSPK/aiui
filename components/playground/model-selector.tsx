"use client"

import * as React from "react"
import { Check, ChevronsUpDown, Box, Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import { useSettingsStore } from "@/lib/stores/settings-store"

// Lightweight provider icon for fast rendering in lists
const PROVIDER_LOGOS: Record<string, string> = {
    'openai': '/providers/openai.svg',
    'claude': '/providers/claude.svg',
    'anthropic': '/providers/claude.svg',
    'gemini': '/providers/gemini.svg',
    'google': '/providers/gemini.svg',
    'vertexai': '/providers/vertexai.svg',
    'vertex': '/providers/vertex.svg',
    'deepseek': '/providers/deepseek.png',
    'moonshot': '/providers/moonshot.png',
    'zhipu': '/providers/zhipu.png',
    'aliyun': '/providers/alibabacloud.png',
    'alibabacloud': '/providers/alibabacloud.png',
    'siliconflow': '/providers/siliconflow.svg',
    'tei': '/providers/tei.svg',
    'transformers': '/providers/transformers.svg',
    'baichuan': '/providers/baichuan.png',
    'volcengine': '/providers/volcengine.png',
    'stepfun': '/providers/stepfun.png',
}

const DARK_INVERT_PROVIDERS = new Set(['openai', 'vertex', 'vertexai', 'siliconflow'])

const ProviderIconLight = React.memo(({ provider }: { provider: string }) => {
    const normalized = provider.toLowerCase().replace(/[^a-z0-9_]/g, '')
    const src = PROVIDER_LOGOS[normalized]
    const isDarkInvert = DARK_INVERT_PROVIDERS.has(normalized)

    if (src) {
        return (
            <img
                src={src}
                alt=""
                className={cn("h-4 w-4 object-contain", isDarkInvert && "dark:invert")}
                loading="lazy"
            />
        )
    }

    return (
        <span className="h-4 w-4 rounded bg-muted flex items-center justify-center text-[8px] font-bold">
            {provider.substring(0, 2).toUpperCase()}
        </span>
    )
})
ProviderIconLight.displayName = "ProviderIconLight"

const ModelItem = React.memo(({ model, isSelected, onSelect }: { model: any, isSelected: boolean, onSelect: (name: string) => void }) => {
    return (
        <DropdownMenuCheckboxItem
            checked={isSelected}
            onCheckedChange={() => onSelect(model.name)}
            onSelect={(e) => e.preventDefault()}
            data-model-id={model.name}
        >
            <div className="flex items-center gap-2 w-full overflow-hidden">
                <ProviderIconLight provider={model.provider || "unknown"} />
                <span className="truncate">{model.name}</span>
            </div>
        </DropdownMenuCheckboxItem>
    )
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
    const scrollContainerRef = React.useRef<HTMLDivElement>(null)
    const { defaultModel } = useSettingsStore()

    // Optimistic state for instant feedback
    const [optimisticIds, setOptimisticIds] = React.useState<string[]>(selectedModelIds)

    // Sync optimistic state with props
    React.useEffect(() => {
        setOptimisticIds(selectedModelIds)
    }, [selectedModelIds])

    const { data: modelsData, isLoading } = useQuery({
        queryKey: ["models"],
        queryFn: () => api.getModels(),
        staleTime: 5 * 60 * 1000, // Cache for 5 minutes
        gcTime: 10 * 60 * 1000, // Keep in cache for 10 minutes
    })

    // Filter to only chat models
    const models = React.useMemo(() => {
        const allModels = Array.isArray(modelsData) ? modelsData : []
        return allModels.filter(m => m.type === "chat")
    }, [modelsData])

    // Auto-select default model if none selected
    React.useEffect(() => {
        if (!isLoading && models.length > 0 && selectedModelIds.length === 0) {
            // Use user's default model from settings, or fallback
            const userDefault = defaultModel || "gpt-3.5-turbo"
            const hasDefault = models.some(m => m.name === userDefault)
            onModelSelect([hasDefault ? userDefault : models[0].name])
        }
    }, [isLoading, models, selectedModelIds.length, onModelSelect, defaultModel])

    const filteredModels = React.useMemo(() => {
        if (!searchQuery) return models
        return models.filter(m => m.name.toLowerCase().includes(searchQuery.toLowerCase()))
    }, [models, searchQuery])

    // Reset search when closed
    React.useEffect(() => {
        if (!open) {
            setSearchQuery("")
        }
    }, [open])

    // Scroll to first selection on open
    React.useEffect(() => {
        if (open && optimisticIds.length > 0) {
            // Use requestAnimationFrame for immediate scroll after paint
            requestAnimationFrame(() => {
                const firstSelected = optimisticIds[0]
                const element = document.querySelector(`[data-model-id="${firstSelected}"]`)
                if (element) {
                    element.scrollIntoView({ block: "center", behavior: "instant" })
                }
            })
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open])

    // Use a ref to ensure the callback is stable for memoization
    const onModelSelectRef = React.useRef(onModelSelect)
    React.useEffect(() => {
        onModelSelectRef.current = onModelSelect
    })

    // Keep a ref of optimisticIds to read inside the stable callback
    const optimisticIdsRef = React.useRef(optimisticIds)
    React.useLayoutEffect(() => {
        optimisticIdsRef.current = optimisticIds
    }, [optimisticIds])

    const handleSelect = React.useCallback((modelName: string) => {
        const prev = optimisticIdsRef.current
        const isSelected = prev.includes(modelName)
        let newIds = prev

        if (isSelected) {
            if (prev.length > 1) {
                newIds = prev.filter(id => id !== modelName)
            }
        } else {
            newIds = [...prev, modelName]
        }

        if (newIds !== prev) {
            setOptimisticIds(newIds)
            onModelSelectRef.current(newIds)
        }
    }, [])

    const triggerLabel = React.useMemo(() => {
        if (optimisticIds.length === 0) return <span>Select Model</span>
        if (optimisticIds.length === 1) return <span className="truncate">{optimisticIds[0]}</span>
        return <span>{optimisticIds[0]} ..., {optimisticIds.length} models</span>
    }, [optimisticIds])

    return (
        <DropdownMenu open={open} onOpenChange={setOpen}>
            <DropdownMenuTrigger asChild>
                {trigger || (
                    <Button variant="outline" className="w-[300px] justify-between" disabled={isLoading}>
                        <div className="flex items-center gap-2 overflow-hidden">
                            {triggerLabel}
                        </div>
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                )}
            </DropdownMenuTrigger>
            <DropdownMenuContent
                className="w-[300px] duration-0 animate-none"
                align={align}
                side={side}
                onCloseAutoFocus={(e) => e.preventDefault()}
            >
                <div className="px-2 py-2 border-b">
                    <div className="relative">
                        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Search models..."
                            className="pl-8 h-9"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onKeyDown={(e) => e.stopPropagation()}
                        />
                    </div>
                    {/* Selected models chips */}
                    {optimisticIds.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                            {optimisticIds.map((id) => (
                                <button
                                    key={id}
                                    onClick={() => handleSelect(id)}
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs hover:bg-primary/20 transition-colors group"
                                >
                                    <span className="truncate max-w-[120px]">{id}</span>
                                    <X className="h-3 w-3 opacity-50 group-hover:opacity-100" />
                                </button>
                            ))}
                        </div>
                    )}
                </div>
                {isLoading ? (
                    <div className="p-2 text-sm text-muted-foreground">Loading...</div>
                ) : filteredModels.length === 0 ? (
                    <div className="p-2 text-sm text-muted-foreground">No models found</div>
                ) : (
                    <div ref={scrollContainerRef} className="max-h-[300px] overflow-y-auto">
                        {filteredModels.map((model) => (
                            <ModelItem
                                key={model.name}
                                model={model}
                                isSelected={optimisticIds.includes(model.name)}
                                onSelect={handleSelect}
                            />
                        ))}
                    </div>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}


