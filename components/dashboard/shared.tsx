"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

/** Palette used everywhere stats charts render series. Stable order
 *  across pages so the same model gets the same color. */
export const SERIES_COLORS = [
    "var(--color-chart-1, #6366f1)",
    "var(--color-chart-2, #06b6d4)",
    "var(--color-chart-3, #f97316)",
    "var(--color-chart-4, #84cc16)",
    "var(--color-chart-5, #ec4899)",
    "var(--color-chart-6, #eab308)",
    "var(--color-chart-7, #14b8a6)",
    "var(--color-chart-8, #a855f7)",
]

/** Last bucket — "everything else" model aggregate. */
export const OTHER_COLOR = "var(--muted-foreground, #64748b)"

/** Default range options for the time-window picker. */
export const RANGE_OPTIONS = [
    { label: "7d", days: 7 },
    { label: "14d", days: 14 },
    { label: "30d", days: 30 },
] as const

export type RangeDays = (typeof RANGE_OPTIONS)[number]["days"]

/** Shared tooltip style for recharts — matches popover surface. */
export const CHART_TOOLTIP_STYLE: React.CSSProperties = {
    background: "var(--popover)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    fontSize: 12,
}

// ---- formatters ----

export function compactNumber(n: number | null | undefined): string {
    if (n == null) return "—"
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`
    return String(n)
}

export function formatLatency(ms: number | null | undefined): string {
    if (ms == null) return "—"
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(2)}s`
}

export function shortDay(iso: string): string {
    const d = new Date(`${iso}T00:00:00Z`)
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

/** Color a model name → palette slot. `_other` always uses OTHER_COLOR.
 *  Index resolution lives at call site since it's display-order dependent. */
export function modelColor(index: number, key?: string): string {
    if (key === "_other") return OTHER_COLOR
    return SERIES_COLORS[index % SERIES_COLORS.length]
}

// ---- primitives ----

interface KpiProps {
    label: string
    value: React.ReactNode
    sub?: React.ReactNode
    icon: React.ElementType
    tone?: "default" | "danger" | "warn"
}

/** Standard KPI tile used at the top of every stats dashboard. */
export function Kpi({ label, value, sub, icon: Icon, tone = "default" }: KpiProps) {
    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                    {label}
                </CardTitle>
                <span
                    className={cn(
                        "flex h-7 w-7 items-center justify-center rounded-md",
                        tone === "danger" && "bg-destructive/10",
                        tone === "warn" && "bg-amber-500/10",
                        tone === "default" && "bg-primary/10"
                    )}
                >
                    <Icon
                        className={cn(
                            "h-3.5 w-3.5",
                            tone === "danger" && "text-destructive",
                            tone === "warn" && "text-amber-500",
                            tone === "default" && "text-primary"
                        )}
                    />
                </span>
            </CardHeader>
            <CardContent>
                <div className="text-2xl font-semibold tabular-nums">{value}</div>
                {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
            </CardContent>
        </Card>
    )
}

interface RangePickerProps {
    value: number
    onChange: (n: number) => void
}

/** Tiny segmented control for picking the stats window. */
export function RangePicker({ value, onChange }: RangePickerProps) {
    return (
        <div className="inline-flex rounded-md border bg-card p-0.5">
            {RANGE_OPTIONS.map((r) => (
                <button
                    key={r.days}
                    type="button"
                    onClick={() => onChange(r.days)}
                    className={cn(
                        "rounded-sm px-2.5 py-1 text-xs transition-colors",
                        value === r.days
                            ? "bg-secondary text-secondary-foreground font-medium"
                            : "text-muted-foreground hover:text-foreground"
                    )}
                >
                    {r.label}
                </button>
            ))}
        </div>
    )
}

/** Placeholder content when a chart has nothing to show. */
export function EmptyState({ message }: { message: string }) {
    return (
        <div className="flex h-[180px] items-center justify-center text-xs text-muted-foreground">
            {message}
        </div>
    )
}

/** Range header used above each dashboard — date window + range picker
 *  + optional refetch indicator. Keeps page chrome consistent. */
export function StatsToolbar({
    windowStart,
    windowEnd,
    days,
    onDaysChange,
    isFetching,
    leadingNote,
}: {
    windowStart?: string
    windowEnd?: string
    days: number
    onDaysChange: (n: number) => void
    isFetching?: boolean
    /** Optional label shown to the left of the date range; e.g. model name. */
    leadingNote?: React.ReactNode
}) {
    return (
        <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-sm text-muted-foreground">
                {leadingNote && <span className="mr-1">{leadingNote}</span>}
                {windowStart && windowEnd ? (
                    <>
                        Showing <span className="font-medium text-foreground">{windowStart}</span>
                        {" → "}
                        <span className="font-medium text-foreground">{windowEnd}</span>
                    </>
                ) : (
                    "Loading…"
                )}
            </p>
            <div className="flex items-center gap-2">
                {isFetching && (
                    <Loader2Icon className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                )}
                <RangePicker value={days} onChange={onDaysChange} />
            </div>
        </div>
    )
}

function Loader2Icon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 24 24" fill="none" {...props}>
            <path
                d="M21 12a9 9 0 1 1-6.219-8.56"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
            />
        </svg>
    )
}
