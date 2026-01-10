"use client"

import * as React from "react"
import { Check, ChevronsUpDown, Box } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { ProviderIcon } from "@/components/ProviderIcon"

interface ModelSelectorProps {
    selectedModelIds: string[]
    onModelSelect: (ids: string[]) => void
    side?: 'top' | 'bottom' | 'left' | 'right'
    align?: 'start' | 'center' | 'end'
    trigger?: React.ReactNode
}

export function ModelSelector({ selectedModelIds, onModelSelect, side = "top", align = "start", trigger }: ModelSelectorProps) {
    const { data: modelsData, isLoading } = useQuery({
        queryKey: ["models"],
        queryFn: () => api.getModels(),
    })

    // Flatten models if needed, or if api returns array
    // console.log("Models Data", modelsData) 
    // The api.ts returns fetcher<ModelConfig[]> directly, so modelsData is ModelConfig[] or undefined (if simplified) 
    // BUT we saw in api.ts that it returns json.data. So it should be ModelConfig[].

    const models = React.useMemo(() => {
        return Array.isArray(modelsData) ? modelsData : []
    }, [modelsData])

    const handleSelect = (modelName: string) => {
        if (selectedModelIds.includes(modelName)) {
            // Deselect
            // Don't allow empty selection? Or do allow? 
            if (selectedModelIds.length > 1) {
                onModelSelect(selectedModelIds.filter(id => id !== modelName))
            }
        } else {
            // Select
            onModelSelect([...selectedModelIds, modelName])
        }
    }

    // Provider icon helper (mock for now, or match string)
    // In real app, might want to fetch providers to get icon mapping

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                {trigger || (
                    <Button variant="outline" className="w-[300px] justify-between" disabled={isLoading}>
                        <div className="flex items-center gap-2 overflow-hidden">
                            {selectedModelIds.length === 0 ? (
                                <span>Select Model</span>
                            ) : selectedModelIds.length === 1 ? (
                                <span className="truncate">
                                    {selectedModelIds[0]}
                                </span>
                            ) : (
                                <span>{selectedModelIds.length} models selected</span>
                            )}
                        </div>
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                )}
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-[300px]" align={align} side={side}>
                <DropdownMenuLabel>Available Models</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {isLoading ? (
                    <div className="p-2 text-sm text-muted-foreground">Loading...</div>
                ) : models.length === 0 ? (
                    <div className="p-2 text-sm text-muted-foreground">No models found</div>
                ) : (
                    <div className="max-h-[300px] overflow-y-auto">
                        {models.map((model) => {
                            const isSelected = selectedModelIds.includes(model.name)
                            return (
                                <DropdownMenuCheckboxItem
                                    key={model.name}
                                    checked={isSelected}
                                    onCheckedChange={() => handleSelect(model.name)}
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
                        })}
                    </div>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
