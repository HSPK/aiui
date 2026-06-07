"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    Pie,
    PieChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts"
import {
    Activity,
    AlertCircle,
    Clock,
    TrendingUp,
    Zap,
} from "lucide-react"

import { stats } from "@/lib/api"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
    CHART_TOOLTIP_STYLE,
    EmptyState,
    Kpi,
    SERIES_COLORS,
    StatsToolbar,
    compactNumber,
    formatLatency,
    modelColor,
    shortDay,
} from "@/components/dashboard/shared"
import type { StatsModelTrendPoint } from "@/lib/schemas/stats"

/** Pivot `[{day, model, requests}, ...]` (long) into recharts-friendly
 *  wide format `[{day, modelA: n, modelB: n, _other: n}, ...]`. */
function pivotByModel(
    rows: StatsModelTrendPoint[],
    models: string[],
    allDays: string[]
): Array<Record<string, number | string>> {
    const out = new Map<string, Record<string, number | string>>()
    for (const d of allDays) {
        const row: Record<string, number | string> = { day: d }
        for (const m of models) row[m] = 0
        out.set(d, row)
    }
    for (const r of rows) {
        const row = out.get(r.day)
        if (!row) continue
        row[r.model] = ((row[r.model] as number) ?? 0) + r.requests
    }
    return Array.from(out.values())
}

function modelLabel(key: string): string {
    return key === "_other" ? "Other" : key
}

interface SegmentTooltipProps {
    active?: boolean
    label?: string | number
    payload?: ReadonlyArray<{ name?: string | number; value?: number | string; color?: string; dataKey?: string | number }>
    /** Only show the entry whose dataKey matches this. Set by the
     *  per-Bar onMouseMove handler so the tooltip mirrors the hovered
     *  stack segment instead of dumping every model's value. */
    hoveredKey: string | null
}

/** Single-segment tooltip used by the dashboard's stacked usage chart.
 *  Skips zero-valued entries even when no specific segment is hovered. */
function SegmentTooltip({ active, label, payload, hoveredKey }: SegmentTooltipProps) {
    if (!active || !payload?.length) return null

    const entries = payload.filter((p) => Number(p.value ?? 0) > 0)
    if (entries.length === 0) return null

    const focused = hoveredKey
        ? entries.find((p) => String(p.dataKey) === hoveredKey)
        : null
    const visible = focused ? [focused] : entries

    return (
        <div style={CHART_TOOLTIP_STYLE} className="px-2.5 py-2 space-y-1 min-w-[160px]">
            <div className="text-[11px] text-muted-foreground">
                {shortDay(String(label))}
            </div>
            {visible.map((p) => (
                <div
                    key={String(p.dataKey)}
                    className="flex items-center justify-between gap-3 text-xs"
                >
                    <span className="flex items-center gap-1.5 min-w-0">
                        <span
                            className="h-2 w-2 rounded-sm shrink-0"
                            style={{ background: p.color }}
                        />
                        <span className="truncate">{modelLabel(String(p.name))}</span>
                    </span>
                    <span className="tabular-nums font-medium">
                        {compactNumber(Number(p.value))}
                    </span>
                </div>
            ))}
        </div>
    )
}

export default function DashboardPage() {
    const router = useRouter()
    const [days, setDays] = React.useState(14)
    const { data, isLoading, isFetching } = stats.useOverview({ days })

    const totals = data?.totals
    const trend = React.useMemo(() => data?.trend ?? [], [data?.trend])
    const trendByModel = React.useMemo(() => data?.trend_by_model ?? [], [data?.trend_by_model])
    const trendModels = React.useMemo(() => data?.trend_models ?? [], [data?.trend_models])
    const byCapability = data?.by_capability ?? []
    const byModel = data?.by_model ?? []

    const allDays = React.useMemo(() => trend.map((t) => t.day), [trend])
    const stackedData = React.useMemo(
        () => pivotByModel(trendByModel, trendModels, allDays),
        [trendByModel, trendModels, allDays]
    )

    // Track which stack segment the cursor is currently over so the
    // tooltip can show only that model's value for the hovered day.
    const [hoveredKey, setHoveredKey] = React.useState<string | null>(null)

    const errorRate =
        totals && totals.requests > 0
            ? Math.round((totals.failed / totals.requests) * 1000) / 10
            : 0

    const openModel = (name: string) => router.push(`/models/${encodeURIComponent(name)}`)

    return (
        <div className="h-full overflow-y-auto">
            <div className="mx-auto w-full max-w-7xl space-y-4 p-4 md:p-6">
                <StatsToolbar
                    windowStart={data?.window_start}
                    windowEnd={data?.window_end}
                    days={days}
                    onDaysChange={setDays}
                    isFetching={isFetching}
                />

                {/* KPIs */}
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <Kpi
                        label="Requests"
                        icon={Activity}
                        value={compactNumber(totals?.requests ?? 0)}
                        sub={
                            totals
                                ? `${compactNumber(totals.completed)} completed · ${compactNumber(totals.pending)} pending`
                                : "—"
                        }
                    />
                    <Kpi
                        label="Tokens"
                        icon={Zap}
                        value={compactNumber(totals?.total_tokens ?? 0)}
                        sub={
                            totals
                                ? `${compactNumber(totals.prompt_tokens)} prompt · ${compactNumber(totals.completion_tokens)} completion`
                                : "—"
                        }
                    />
                    <Kpi
                        label="Avg Latency"
                        icon={Clock}
                        value={formatLatency(totals?.avg_total_latency_ms ?? null)}
                        sub={
                            totals?.avg_first_token_latency_ms != null
                                ? `${formatLatency(totals.avg_first_token_latency_ms)} time to first token`
                                : "—"
                        }
                    />
                    <Kpi
                        label="Error Rate"
                        icon={AlertCircle}
                        tone={errorRate > 5 ? "danger" : "default"}
                        value={`${errorRate}%`}
                        sub={
                            totals
                                ? `${compactNumber(totals.failed)} failed of ${compactNumber(totals.requests)}`
                                : "—"
                        }
                    />
                </div>

                {/* Stacked usage + capability split */}
                <div className="grid gap-4 lg:grid-cols-7">
                    <Card className="lg:col-span-5">
                        <CardHeader className="flex flex-row items-start justify-between space-y-0">
                            <div>
                                <CardTitle className="text-base flex items-center gap-2">
                                    <TrendingUp className="h-4 w-4 text-primary" />
                                    Usage by model
                                </CardTitle>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                    Requests per day, stacked by top {trendModels.length} model{trendModels.length === 1 ? "" : "s"}
                                </p>
                            </div>
                        </CardHeader>
                        <CardContent>
                            {trendModels.length === 0 ? (
                                <EmptyState message={isLoading ? "Loading…" : "No data"} />
                            ) : (
                                <ResponsiveContainer width="100%" height={280}>
                                    <BarChart
                                        data={stackedData}
                                        margin={{ left: -8, right: 8, top: 8, bottom: 0 }}
                                    >
                                        <CartesianGrid
                                            strokeDasharray="3 3"
                                            stroke="currentColor"
                                            strokeOpacity={0.08}
                                        />
                                        <XAxis
                                            dataKey="day"
                                            tickFormatter={shortDay}
                                            tick={{ fontSize: 11, fill: "currentColor", opacity: 0.6 }}
                                            axisLine={false}
                                            tickLine={false}
                                        />
                                        <YAxis
                                            tick={{ fontSize: 11, fill: "currentColor", opacity: 0.6 }}
                                            axisLine={false}
                                            tickLine={false}
                                            tickFormatter={(v) => compactNumber(Number(v))}
                                        />
                                        <Tooltip
                                            cursor={{ fill: "currentColor", opacity: 0.04 }}
                                            content={(props) => (
                                                <SegmentTooltip
                                                    {...(props as unknown as Omit<SegmentTooltipProps, "hoveredKey">)}
                                                    hoveredKey={hoveredKey}
                                                />
                                            )}
                                        />
                                        {trendModels.map((m, idx) => (
                                            <Bar
                                                key={m}
                                                dataKey={m}
                                                stackId="usage"
                                                fill={modelColor(idx, m)}
                                                radius={idx === trendModels.length - 1 ? [3, 3, 0, 0] : 0}
                                                cursor={m === "_other" ? "default" : "pointer"}
                                                onMouseEnter={() => setHoveredKey(m)}
                                                onMouseLeave={() =>
                                                    setHoveredKey((prev) => (prev === m ? null : prev))
                                                }
                                                onClick={
                                                    m === "_other"
                                                        ? undefined
                                                        : () => openModel(m)
                                                }
                                            />
                                        ))}
                                    </BarChart>
                                </ResponsiveContainer>
                            )}
                        </CardContent>
                    </Card>

                    <Card className="lg:col-span-2">
                        <CardHeader>
                            <CardTitle className="text-base">By capability</CardTitle>
                            <p className="text-xs text-muted-foreground mt-0.5">
                                Share of requests
                            </p>
                        </CardHeader>
                        <CardContent>
                            {byCapability.length === 0 ? (
                                <EmptyState message={isLoading ? "Loading…" : "No data"} />
                            ) : (
                                <>
                                    <ResponsiveContainer width="100%" height={180}>
                                        <PieChart>
                                            <Pie
                                                data={byCapability}
                                                dataKey="requests"
                                                nameKey="label"
                                                innerRadius={42}
                                                outerRadius={70}
                                                paddingAngle={2}
                                            >
                                                {byCapability.map((_, idx) => (
                                                    <Cell
                                                        key={idx}
                                                        fill={SERIES_COLORS[idx % SERIES_COLORS.length]}
                                                    />
                                                ))}
                                            </Pie>
                                            <Tooltip
                                                contentStyle={CHART_TOOLTIP_STYLE}
                                                formatter={(value) => [compactNumber(Number(value)), "Requests"]}
                                            />
                                        </PieChart>
                                    </ResponsiveContainer>
                                    <ul className="mt-2 space-y-1 text-xs">
                                        {byCapability.slice(0, 6).map((b, idx) => (
                                            <li
                                                key={b.key}
                                                className="flex items-center justify-between gap-2"
                                            >
                                                <span className="flex items-center gap-1.5 min-w-0">
                                                    <span
                                                        className="h-2 w-2 rounded-sm shrink-0"
                                                        style={{
                                                            background:
                                                                SERIES_COLORS[idx % SERIES_COLORS.length],
                                                        }}
                                                    />
                                                    <span className="truncate text-muted-foreground">
                                                        {b.label}
                                                    </span>
                                                </span>
                                                <span className="tabular-nums">
                                                    {compactNumber(b.requests)}
                                                </span>
                                            </li>
                                        ))}
                                    </ul>
                                </>
                            )}
                        </CardContent>
                    </Card>
                </div>

                {/* Top models — click to drill into per-model dashboard */}
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">Top models</CardTitle>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            Most-requested models in window · click a row to open the model dashboard
                        </p>
                    </CardHeader>
                    <CardContent>
                        {byModel.length === 0 ? (
                            <EmptyState message={isLoading ? "Loading…" : "No data"} />
                        ) : (
                            <ResponsiveContainer
                                width="100%"
                                height={Math.max(180, byModel.length * 36 + 24)}
                            >
                                <BarChart
                                    data={byModel}
                                    layout="vertical"
                                    margin={{ top: 4, right: 24, bottom: 4, left: 8 }}
                                >
                                    <CartesianGrid
                                        strokeDasharray="3 3"
                                        stroke="currentColor"
                                        strokeOpacity={0.08}
                                        horizontal={false}
                                    />
                                    <XAxis
                                        type="number"
                                        tick={{ fontSize: 11, fill: "currentColor", opacity: 0.6 }}
                                        axisLine={false}
                                        tickLine={false}
                                        tickFormatter={(v) => compactNumber(Number(v))}
                                    />
                                    <YAxis
                                        type="category"
                                        dataKey="label"
                                        width={180}
                                        tick={{ fontSize: 11, fill: "currentColor", opacity: 0.8 }}
                                        axisLine={false}
                                        tickLine={false}
                                    />
                                    <Tooltip
                                        contentStyle={CHART_TOOLTIP_STYLE}
                                        cursor={{ fill: "currentColor", opacity: 0.04 }}
                                        formatter={(value, name) => [
                                            compactNumber(Number(value)),
                                            name === "requests" ? "Requests" : "Tokens",
                                        ]}
                                    />
                                    <Bar
                                        dataKey="requests"
                                        radius={[0, 4, 4, 0]}
                                        cursor="pointer"
                                        onClick={(d) => {
                                            const key = (d as unknown as { key?: string })?.key
                                            if (key) openModel(key)
                                        }}
                                    >
                                        {byModel.map((b, idx) => (
                                            <Cell key={b.key} fill={modelColor(idx, b.key)} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
