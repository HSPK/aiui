"use client"

import * as React from "react"
import { Bot, ChevronDown, Search, X } from "lucide-react"

import { models } from "@/lib/api/models"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"
import { ProviderIcon } from "@/components/ProviderIcon"
import type { ModelDTO } from "@/lib/schemas/model"

import { CAPABILITY_HEURISTIC, matchesCapability } from "./modality-filters"

interface ModalityMultiModelSelectorProps {
    capability: string
    value: string[]
    onChange: (next: string[]) => void
    maxModels?: number
    className?: string
}

/** Multi-pick model selector for non-chat modality playgrounds.
 *  Shows the selected models as removable chips next to the trigger. */
export function ModalityMultiModelSelector({
    capability,
    value,
    onChange,
    maxModels = 6,
    className,
}: ModalityMultiModelSelectorProps) {
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

    const valueSet = React.useMemo(() => new Set(value), [value])

    const selectedModels = React.useMemo(() => {
        if (!Array.isArray(data) || value.length === 0) return []
        const byName = new Map<string, ModelDTO>(data.map((m) => [m.name, m]))
        return value.map((name) => byName.get(name) ?? null)
    }, [value, data])

    const toggle = (name: string) => {
        if (valueSet.has(name)) {
            onChange(value.filter((v) => v !== name))
        } else if (value.length < maxModels) {
            onChange([...value, name])
        }
    }

    const hasHeuristic = !!CAPABILITY_HEURISTIC[capability]

    return (
        <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <button
                        type="button"
                        disabled={isLoading}
                        className={cn(
                            "inline-flex items-center gap-2 h-9 px-3 rounded-md border bg-background text-sm hover:bg-muted/40 transition-colors",
                            isLoading && "opacity-60 cursor-not-allowed"
                        )}
                    >
                        <Bot className="h-4 w-4 text-muted-foreground" />
                        <span>
                            {value.length > 0
                                ? `${value.length} model${value.length === 1 ? "" : "s"}`
                                : isLoading
                                  ? "Loading…"
                                  : "Pick models"}
                        </span>
                        <ChevronDown className="h-4 w-4 opacity-50" />
                    </button>
                </PopoverTrigger>
                <PopoverContent className="w-[340px] p-0" align="start">
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
                                <p>
                                    {isLoading ? "Loading…" : `No ${capability} models found`}
                                </p>
                                {!isLoading && hasHeuristic && (
                                    <p className="text-[11px]">
                                        Check that your provider exposes one and that discovery succeeded.
                                    </p>
                                )}
                            </div>
                        ) : (
                            filtered.map((m) => {
                                const checked = valueSet.has(m.name)
                                const disabled = !checked && value.length >= maxModels
                                return (
                                    <button
                                        key={m.name}
                                        type="button"
                                        onClick={() => !disabled && toggle(m.name)}
                                        disabled={disabled}
                                        className={cn(
                                            "w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-sm text-left transition-colors",
                                            checked
                                                ? "bg-accent text-accent-foreground"
                                                : "hover:bg-muted/50",
                                            disabled && !checked && "opacity-50 cursor-not-allowed"
                                        )}
                                    >
                                        <span
                                            className={cn(
                                                "h-3.5 w-3.5 rounded-sm border flex items-center justify-center shrink-0",
                                                checked
                                                    ? "bg-primary border-primary text-primary-foreground"
                                                    : "border-muted-foreground/30"
                                            )}
                                        >
                                            {checked && <span className="text-[10px]">✓</span>}
                                        </span>
                                        <ProviderIcon providerName={m.provider ?? "?"} />
                                        <span className="truncate flex-1">{m.name}</span>
                                        {m.type !== capability && (
                                            <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wider">
                                                {m.type}
                                            </span>
                                        )}
                                    </button>
                                )
                            })
                        )}
                    </div>
                    {value.length >= maxModels && (
                        <div className="px-3 py-1.5 border-t text-[11px] text-muted-foreground">
                            Max {maxModels} models. Remove one to add more.
                        </div>
                    )}
                </PopoverContent>
            </Popover>

            {selectedModels.map((m, idx) => {
                const name = value[idx]
                if (!name) return null
                return (
                    <Badge
                        key={name}
                        variant="secondary"
                        className="h-7 pl-1.5 pr-0.5 gap-1 font-normal text-xs"
                    >
                        {m && <ProviderIcon providerName={m.provider ?? "?"} />}
                        <span className="truncate max-w-[140px]">{name}</span>
                        <button
                            type="button"
                            onClick={() => toggle(name)}
                            className="ml-0.5 h-5 w-5 inline-flex items-center justify-center rounded hover:bg-muted-foreground/10"
                            aria-label={`Remove ${name}`}
                        >
                            <X className="h-3 w-3" />
                        </button>
                    </Badge>
                )
            })}
        </div>
    )
}
