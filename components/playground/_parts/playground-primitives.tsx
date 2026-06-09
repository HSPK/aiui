"use client"

import * as React from "react"
import { Sparkles, type LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Small reusable affordances used across the non-chat playgrounds.
 *
 * `<PromptChips>` — tappable example prompts. Lowers the cold-start
 *   cost of "blank page anxiety" — the user clicks one and immediately
 *   sees what the modality is capable of.
 *
 * `<EmptyHint>` — quiet placeholder shown in the result slot before
 *   any generation has happened. Replaces the silence that used to
 *   sit below the form with a soft prompt.
 *
 * `<SkeletonGrid>` — pulsing tile grid shown while the upstream is
 *   working. Cheaper to read than an indeterminate spinner; the user
 *   can see how many results are coming.
 */

export function PromptChips({
    examples,
    onPick,
    label = "Try",
}: {
    examples: string[]
    onPick: (text: string) => void
    label?: string
}) {
    if (examples.length === 0) return null
    return (
        <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground/60 mr-1">
                {label}
            </span>
            {examples.map((ex, i) => (
                <button
                    key={i}
                    type="button"
                    onClick={() => onPick(ex)}
                    className={cn(
                        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs",
                        "text-muted-foreground hover:text-foreground hover:border-foreground/30 hover:bg-muted/40 transition-colors",
                        "max-w-[280px] truncate",
                    )}
                    title={ex}
                >
                    <Sparkles className="h-3 w-3 shrink-0" />
                    <span className="truncate">{ex}</span>
                </button>
            ))}
        </div>
    )
}

export function EmptyHint({
    icon: Icon,
    title,
    description,
    children,
}: {
    icon: LucideIcon
    title: string
    description?: React.ReactNode
    children?: React.ReactNode
}) {
    return (
        <div className="rounded-lg border border-dashed bg-muted/20 px-4 py-8 text-center">
            <Icon className="h-8 w-8 mx-auto mb-2.5 text-muted-foreground/40" />
            <p className="text-sm font-medium text-foreground/80">{title}</p>
            {description && (
                <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">{description}</p>
            )}
            {children && <div className="mt-3 flex justify-center">{children}</div>}
        </div>
    )
}

export function SkeletonGrid({ count, cols = 3 }: { count: number; cols?: number }) {
    const cells = Array.from({ length: count }, (_, i) => i)
    const gridClass =
        cols === 1 ? "grid-cols-1" :
        cols === 2 ? "grid-cols-1 sm:grid-cols-2" :
        "grid-cols-2 sm:grid-cols-2 lg:grid-cols-3"
    return (
        <div className={cn("grid gap-3", gridClass)}>
            {cells.map((i) => (
                <div
                    key={i}
                    className="aspect-square rounded-md border bg-muted/30 animate-pulse"
                />
            ))}
        </div>
    )
}
