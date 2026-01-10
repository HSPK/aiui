"use client"

import * as React from "react"
import { Check, ChevronsUpDown, Box, Search } from "lucide-react"
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
import { ProviderIcon } from "@/components/ProviderIcon"

const ModelItem = React.memo(({ model, isSelected, onSelect }: { model: any, isSelected: boolean, onSelect: (name: string) => void }) => {
    return (
        <DropdownMenuCheckboxItem
            checked={isSelected}
            onCheckedChange={() => onSelect(model.name)}
            onSelect={(e) => e.preventDefault()}
            data-model-id={model.name}
        >
             <div className="flex items-center gap-2 w-full overflow-hidden">
                <div className="h-4 w-4 shrink-0 flex items-center justify-center">
                    <ProviderIcon
                        providerName={model.provider || "unknown"}
                        className="h-4 w-4"
                        width={16}
                        height={16}
                    />
                </div>
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

    // Optimistic state for instant feedback
    const [optimisticIds, setOptimisticIds] = React.useState<string[]>(selectedModelIds)

    // Sync optimistic state with props
    React.useEffect(() => {
        setOptimisticIds(selectedModelIds)
    }, [selectedModelIds])

    const { data: modelsData, isLoading } = useQuery({
        queryKey: ["models"],
        queryFn: () => api.getModels(),
    })

    const models = React.useMemo(() => {
        return Array.isArray(modelsData) ? modelsData : []
    }, [modelsData])

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
            // Find the element with the data-model-id attribute matching the first selected id
            // We use a slight timeout to allow the dropdown animation/render to happen
            const timer = setTimeout(() => {
                const firstSelected = optimisticIds[0]
                const element = document.querySelector(`[data-model-id="${firstSelected}"]`)
                if (element) {
                    element.scrollIntoView({ block: "center", behavior: "smooth" })
                }
            }, 100)
            return () => clearTimeout(timer)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open])

    // Use a ref to ensure the callback is stable for memoization
    const onModelSelectRef = React.useRef(onModelSelect)
    React.useEffect(() => {
        onModelSelectRef.current = onModelSelect
    })

    const handleSelect = React.useCallback((modelName: string) => {
        setOptimisticIds(prev => {
            const isSelected = prev.includes(modelName)
            let newIds
            if (isSelected) {
                 // Prevent deselecting if it's the last one, or allow it?
                 // Usually select at least one is good, but let's allow empty if user wants, 
                 // though the UI shows "Select Model". 
                 // Actually the original code prevented empty: "if (selectedModelIds.length > 1)"
                 // Let's keep that behavior.
                if (prev.length > 1) {
                    newIds = prev.filter(id => id !== modelName)
                } else {
                    return prev
                }
            } else {
                newIds = [...prev, modelName]
            }
            onModelSelectRef.current(newIds)
            return newIds
        })
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
                className="w-[300px]"
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


