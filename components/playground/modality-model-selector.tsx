"use client"

import * as React from "react"
import { Bot, ChevronDown, Search } from "lucide-react"

import { models } from "@/lib/api"
import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"
import { ProviderIcon } from "@/components/ProviderIcon"

import { CAPABILITY_HEURISTIC, matchesCapability } from "./modality-filters"

interface ModalitySingleModelSelectorProps {
    /** Capability id (matches `ModelDTO.type`) used to filter the catalog. */
    capability: string
    value: string | null
    onChange: (modelName: string) => void
    placeholder?: string
    className?: string
}

export function ModalitySingleModelSelector({
    capability,
    value,
    onChange,
    placeholder = "Select a model",
    className,
}: ModalitySingleModelSelectorProps) {
    const [open, setOpen] = React.useState(false)
    const [search, setSearch] = React.useState("")

    const { data, isLoading } = models.useList(undefined, {
        staleTime: 5 * 60 * 1000,
    })

    const filtered = React.useMemo(() => {
        const all = Array.isArray(data) ? data : []
        const capMatch = all.filter((m) => matchesCapability(m, capability))
        if (!search) return capMatch
        const q = search.toLowerCase()
        return capMatch.filter(
            (m) =>
                m.name.toLowerCase().includes(q) ||
                (m.model_id ?? "").toLowerCase().includes(q)
        )
    }, [data, search, capability])

    React.useEffect(() => {
        if (!open) setSearch("")
    }, [open])

    const selected = React.useMemo(() => {
        if (!value || !Array.isArray(data)) return null
        return data.find((m) => m.name === value) ?? null
    }, [value, data])

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    disabled={isLoading}
                    className={cn(
                        "inline-flex items-center gap-2 h-9 px-3 rounded-md border bg-background text-sm hover:bg-muted/40 transition-colors min-w-[200px] justify-between",
                        isLoading && "opacity-60 cursor-not-allowed",
                        className
                    )}
                >
                    <span className="flex items-center gap-2 min-w-0">
                        {selected ? (
                            <>
                                <ProviderIcon providerName={selected.provider ?? "?"} />
                                <span className="truncate">{selected.name}</span>
                            </>
                        ) : (
                            <>
                                <Bot className="h-4 w-4 text-muted-foreground" />
                                <span className="text-muted-foreground">
                                    {isLoading ? "Loading…" : placeholder}
                                </span>
                            </>
                        )}
                    </span>
                    <ChevronDown className="h-4 w-4 opacity-50 shrink-0" />
                </button>
            </PopoverTrigger>
            <PopoverContent className="w-[320px] p-0" align="start">
                <div className="p-2 border-b">
                    <div className="relative">
                        <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
                        <Input
                            placeholder={`Search ${capability} models…`}
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="pl-7 h-8 text-sm"
                        />
                    </div>
                </div>
                <div className="max-h-[280px] overflow-y-auto p-1">
                    {filtered.length === 0 ? (
                        <div className="p-3 text-sm text-muted-foreground text-center space-y-1">
                            <p>{isLoading ? "Loading…" : `No ${capability} models found`}</p>
                            {!isLoading && !!CAPABILITY_HEURISTIC[capability] && (
                                <p className="text-[11px]">
                                    Check that your provider exposes one and that discovery succeeded.
                                </p>
                            )}
                        </div>
                    ) : (
                        filtered.map((m) => (
                            <button
                                key={m.name}
                                type="button"
                                onClick={() => {
                                    onChange(m.name)
                                    setOpen(false)
                                }}
                                className={cn(
                                    "w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-sm text-left transition-colors",
                                    value === m.name
                                        ? "bg-accent text-accent-foreground"
                                        : "hover:bg-muted/50"
                                )}
                            >
                                <ProviderIcon providerName={m.provider ?? "?"} />
                                <span className="truncate flex-1">{m.name}</span>
                                {m.type !== capability && (
                                    <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wider">
                                        {m.type}
                                    </span>
                                )}
                            </button>
                        ))
                    )}
                </div>
            </PopoverContent>
        </Popover>
    )
}
