"use client"

import * as React from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import {
    Area,
    AreaChart,
    Bar,
    BarChart,
    CartesianGrid,
    Legend,
    Line,
    LineChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts"
import {
    Activity,
    AlertCircle,
    Bot,
    ChevronLeft,
    Clock,
    MessageSquare,
    Zap,
} from "lucide-react"

import { stats } from "@/lib/api"
import { usePlaygroundStore } from "@/lib/stores/playground-store"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
    CHART_TOOLTIP_STYLE,
    EmptyState,
    Kpi,
    SERIES_COLORS,
    StatsToolbar,
    compactNumber,
    formatLatency,
    shortDay,
} from "@/components/dashboard/shared"
import { ProviderIcon } from "@/components/ProviderIcon"

export default function ModelDashboardPage() {
    const params = useParams()
    const router = useRouter()
    const modelName = decodeURIComponent(String(params.name ?? ""))
    const [days, setDays] = React.useState(14)
    const { data, isLoading, isFetching, error } = stats.useModel(modelName, { days })

    /** Open the chat playground with this model preselected. We have
     *  to seed the per-conversation settings store BEFORE navigating
     *  so the chat-flow's model selector picks it up on first render. */
    const tryInPlayground = React.useCallback(() => {
        const id =
            typeof crypto !== "undefined" && "randomUUID" in crypto
                ? crypto.randomUUID()
                : String(Date.now())
        usePlaygroundStore.getState().updateSettings(id, { modelIds: [modelName] })
        router.push(`/playground/chat?c=${encodeURIComponent(id)}`)
    }, [modelName, router])

    const totals = data?.totals
    const trend = React.useMemo(() => data?.trend ?? [], [data?.trend])

    const errorRate =
        totals && totals.requests > 0
            ? Math.round((totals.failed / totals.requests) * 1000) / 10
            : 0

    // Error rate per day, percent.
    const errorTrend = React.useMemo(
        () =>
            trend.map((d) => ({
                day: d.day,
                rate:
                    d.requests > 0
                        ? Math.round((d.failed / d.requests) * 1000) / 10
                        : 0,
                failed: d.failed,
                requests: d.requests,
            })),
        [trend]
    )

    // Latency trend keeps both TTFT and total — line per metric, ms unit.
    const latencyTrend = React.useMemo(
        () =>
            trend.map((d) => ({
                day: d.day,
                first: d.avg_first_token_latency_ms ?? null,
                total: d.avg_total_latency_ms ?? null,
            })),
        [trend]
    )

    const hasData = trend.some((t) => t.requests > 0)

    return (
        <div className="h-full overflow-y-auto">
            <div className="mx-auto w-full max-w-7xl space-y-4 p-4 md:p-6">
                {/* Breadcrumb */}
                <Link
                    href="/"
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                    <ChevronLeft className="h-3 w-3" />
                    Dashboard
                </Link>

                {/* Model identity card */}
                <Card>
                    <CardContent className="p-4 md:p-5">
                        <div className="flex flex-wrap items-start justify-between gap-4">
                            <div className="flex items-start gap-3 min-w-0">
                                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-primary/20 to-primary/5 shrink-0">
                                    {data?.provider ? (
                                        <ProviderIcon
                                            providerName={data.provider}
                                            className="h-6 w-6"
                                            width={24}
                                            height={24}
                                        />
                                    ) : (
                                        <Bot className="h-5 w-5 text-primary" />
                                    )}
                                </span>
                                <div className="min-w-0 space-y-1">
                                    <h1
                                        className="text-lg font-semibold tracking-tight truncate"
                                        title={modelName}
                                    >
                                        {modelName}
                                    </h1>
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                        {data?.provider && (
                                            <Badge variant="outline" className="text-[10px] font-medium">
                                                {data.provider}
                                            </Badge>
                                        )}
                                        {data?.capability && (
                                            <Badge variant="outline" className="text-[10px] font-medium uppercase tracking-wider">
                                                {data.capability}
                                            </Badge>
                                        )}
                                        {data?.context_window != null && (
                                            <Badge variant="secondary" className="text-[10px] font-medium">
                                                {compactNumber(data.context_window)} ctx
                                            </Badge>
                                        )}
                                        {!!data && !data.provider && !data.capability && (
                                            <Badge variant="outline" className="text-[10px] text-muted-foreground">
                                                Not registered
                                            </Badge>
                                        )}
                                    </div>
                                    {isLoading && !data ? (
                                        <Skeleton className="h-3 w-72" />
                                    ) : (
                                        data?.description && (
                                            <p className="text-xs text-muted-foreground leading-relaxed max-w-prose">
                                                {data.description}
                                            </p>
                                        )
                                    )}
                                </div>
                            </div>
                            {data?.capability === "chat" && (
                                <button
                                    type="button"
                                    onClick={tryInPlayground}
                                    className="inline-flex items-center gap-1.5 rounded-md border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted/40 transition-colors"
                                >
                                    <MessageSquare className="h-3.5 w-3.5" />
                                    Try in playground
                                </button>
                            )}
                        </div>
                    </CardContent>
                </Card>

                {/* Toolbar */}
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

                {/* Usage trend — stacked success / failed */}
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">Usage trend</CardTitle>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            Daily requests split by outcome
                        </p>
                    </CardHeader>
                    <CardContent>
                        {!hasData && !isLoading ? (
                            <EmptyState message={error ? "Failed to load" : "No requests in window"} />
                        ) : (
                            <ResponsiveContainer width="100%" height={260}>
                                <BarChart
                                    data={trend.map((d) => ({
                                        day: d.day,
                                        success: Math.max(0, d.requests - d.failed),
                                        failed: d.failed,
                                    }))}
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
                                        contentStyle={CHART_TOOLTIP_STYLE}
                                        labelFormatter={(label) => shortDay(String(label))}
                                        formatter={(value, name) => [
                                            compactNumber(Number(value)),
                                            name === "success" ? "Success" : "Failed",
                                        ]}
                                        cursor={{ fill: "currentColor", opacity: 0.04 }}
                                    />
                                    <Legend
                                        iconType="circle"
                                        wrapperStyle={{ fontSize: 11, paddingTop: 6 }}
                                        formatter={(v) => (v === "success" ? "Success" : "Failed")}
                                    />
                                    <Bar
                                        dataKey="success"
                                        stackId="usage"
                                        fill={SERIES_COLORS[0]}
                                    />
                                    <Bar
                                        dataKey="failed"
                                        stackId="usage"
                                        fill="var(--destructive)"
                                        radius={[3, 3, 0, 0]}
                                    />
                                </BarChart>
                            </ResponsiveContainer>
                        )}
                    </CardContent>
                </Card>

                {/* Error rate + latency trends, side by side */}
                <div className="grid gap-4 lg:grid-cols-2">
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base">Error rate</CardTitle>
                            <p className="text-xs text-muted-foreground mt-0.5">
                                Percent of requests that failed
                            </p>
                        </CardHeader>
                        <CardContent>
                            {!hasData && !isLoading ? (
                                <EmptyState message="No data" />
                            ) : (
                                <ResponsiveContainer width="100%" height={220}>
                                    <AreaChart
                                        data={errorTrend}
                                        margin={{ left: -8, right: 8, top: 8, bottom: 0 }}
                                    >
                                        <defs>
                                            <linearGradient id="errGradient" x1="0" y1="0" x2="0" y2="1">
                                                <stop
                                                    offset="5%"
                                                    stopColor="var(--destructive)"
                                                    stopOpacity={0.3}
                                                />
                                                <stop
                                                    offset="95%"
                                                    stopColor="var(--destructive)"
                                                    stopOpacity={0}
                                                />
                                            </linearGradient>
                                        </defs>
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
                                            tickFormatter={(v) => `${v}%`}
                                            domain={[0, (max: number) => Math.max(5, Math.ceil(max + 1))]}
                                        />
                                        <Tooltip
                                            contentStyle={CHART_TOOLTIP_STYLE}
                                            labelFormatter={(label) => shortDay(String(label))}
                                            formatter={(value, _name, item) => {
                                                const payload = (item as { payload?: { failed?: number; requests?: number } })?.payload
                                                const failed = payload?.failed ?? 0
                                                const requests = payload?.requests ?? 0
                                                return [
                                                    `${Number(value).toFixed(1)}%`,
                                                    `${failed}/${requests}`,
                                                ]
                                            }}
                                        />
                                        <Area
                                            type="monotone"
                                            dataKey="rate"
                                            stroke="var(--destructive)"
                                            strokeWidth={2}
                                            fill="url(#errGradient)"
                                        />
                                    </AreaChart>
                                </ResponsiveContainer>
                            )}
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base">Latency</CardTitle>
                            <p className="text-xs text-muted-foreground mt-0.5">
                                Avg time to first token (TTFT) and end-to-end
                            </p>
                        </CardHeader>
                        <CardContent>
                            {!hasData && !isLoading ? (
                                <EmptyState message="No data" />
                            ) : (
                                <ResponsiveContainer width="100%" height={220}>
                                    <LineChart
                                        data={latencyTrend}
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
                                            tickFormatter={(v) => formatLatency(Number(v))}
                                        />
                                        <Tooltip
                                            contentStyle={CHART_TOOLTIP_STYLE}
                                            labelFormatter={(label) => shortDay(String(label))}
                                            formatter={(value, name) => [
                                                value == null ? "—" : formatLatency(Number(value)),
                                                name === "first" ? "TTFT" : "Total",
                                            ]}
                                        />
                                        <Legend
                                            iconType="circle"
                                            wrapperStyle={{ fontSize: 11, paddingTop: 6 }}
                                            formatter={(v) => (v === "first" ? "TTFT" : "Total")}
                                        />
                                        <Line
                                            type="monotone"
                                            dataKey="first"
                                            stroke={SERIES_COLORS[1]}
                                            strokeWidth={2}
                                            dot={false}
                                            connectNulls
                                        />
                                        <Line
                                            type="monotone"
                                            dataKey="total"
                                            stroke={SERIES_COLORS[0]}
                                            strokeWidth={2}
                                            dot={false}
                                            connectNulls
                                        />
                                    </LineChart>
                                </ResponsiveContainer>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    )
}