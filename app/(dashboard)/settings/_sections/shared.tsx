"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ChevronDown, Search } from "lucide-react"
import { ProviderIcon } from "@/components/ProviderIcon"

export function SettingsSection({
    icon: Icon,
    title,
    description,
    action,
    children,
}: {
    icon: React.ElementType
    title: string
    description?: string
    action?: React.ReactNode
    children: React.ReactNode
}) {
    return (
        <Card>
            <CardHeader className="pb-4">
                <div className="flex items-center gap-2">
                    <div className="rounded-lg bg-primary/10 p-2">
                        <Icon className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <CardTitle className="text-base">{title}</CardTitle>
                        {description && (
                            <CardDescription className="text-sm">{description}</CardDescription>
                        )}
                    </div>
                    {action}
                </div>
            </CardHeader>
            <CardContent className="space-y-4">{children}</CardContent>
        </Card>
    )
}

export function SettingsField({
    label,
    description,
    children,
    stacked,
}: {
    label: string
    description?: string
    children: React.ReactNode
    /** When true, render children below the label instead of beside it. */
    stacked?: boolean
}) {
    if (stacked) {
        return (
            <div className="space-y-2">
                <div className="space-y-0.5">
                    <span className="text-sm font-medium">{label}</span>
                    {description && (
                        <p className="text-xs text-muted-foreground">{description}</p>
                    )}
                </div>
                <div>{children}</div>
            </div>
        )
    }
    return (
        <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center sm:gap-4">
            <div className="shrink-0 space-y-0.5">
                <span className="text-sm font-medium">{label}</span>
                {description && (
                    <p className="text-xs text-muted-foreground">{description}</p>
                )}
            </div>
            <div className="w-full sm:max-w-[280px]">{children}</div>
        </div>
    )
}

interface ModelOption {
    name: string
    provider?: string
}

/** Searchable native dropdown — preserved verbatim from the previous page. */
export const ModelSelect = React.memo(function ModelSelect({
    value,
    onValueChange,
    models,
    isLoading,
    placeholder,
}: {
    value: string
    onValueChange: (v: string) => void
    models: ModelOption[]
    isLoading: boolean
    placeholder: string
}) {
    const [open, setOpen] = React.useState(false)
    const [search, setSearch] = React.useState("")
    const containerRef = React.useRef<HTMLDivElement>(null)

    const filtered = React.useMemo(() => {
        if (!search) return models
        const q = search.toLowerCase()
        return models.filter((m) => m.name.toLowerCase().includes(q))
    }, [models, search])

    React.useEffect(() => {
        if (!open) return
        const handler = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setOpen(false)
            }
        }
        document.addEventListener("mousedown", handler)
        return () => document.removeEventListener("mousedown", handler)
    }, [open])

    React.useEffect(() => {
        if (!open) setSearch("")
    }, [open])

    return (
        <div ref={containerRef} className="relative">
            <button
                type="button"
                onClick={() => !isLoading && setOpen(!open)}
                className={cn(
                    "flex h-9 w-full items-center justify-between rounded-md border bg-transparent px-3 text-sm",
                    "transition-colors hover:bg-muted/50",
                    isLoading && "cursor-not-allowed opacity-50"
                )}
                disabled={isLoading}
            >
                <span className="truncate">{value || placeholder}</span>
                <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
            </button>
            {open && (
                <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md">
                    <div className="border-b p-2">
                        <div className="relative">
                            <Search className="absolute left-2 top-1.5 h-3.5 w-3.5 text-muted-foreground" />
                            <Input
                                placeholder="Search..."
                                className="h-7 pl-7 text-xs"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                autoFocus
                            />
                        </div>
                    </div>
                    <div className="scrollbar-thin max-h-[240px] overflow-y-auto p-1">
                        {filtered.length === 0 ? (
                            <div className="p-2 text-sm text-muted-foreground">No models</div>
                        ) : (
                            filtered.map((model) => (
                                <button
                                    key={model.name}
                                    type="button"
                                    onClick={() => {
                                        onValueChange(model.name)
                                        setOpen(false)
                                    }}
                                    className={cn(
                                        "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs",
                                        value === model.name ? "bg-accent" : "hover:bg-muted/50"
                                    )}
                                >
                                    <ProviderIcon providerName={model.provider || "?"} />
                                    <span className="truncate">{model.name}</span>
                                </button>
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
    )
})
