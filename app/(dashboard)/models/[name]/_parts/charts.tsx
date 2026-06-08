"use client"

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

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
    CHART_TOOLTIP_STYLE,
    EmptyState,
    SERIES_COLORS,
    compactNumber,
    formatLatency,
    shortDay,
} from "@/components/dashboard/shared"

/**
 * Per-model chart cards used by the model detail page.
 *
 * Each card receives just the slice of trend data it needs +
 * `isLoading`/`hasData` flags so future tweaks to one chart never
 * ripple through the others. Shared chart tokens
 * (CHART_TOOLTIP_STYLE / SERIES_COLORS) come from the dashboard
 * shared module so the visual language stays consistent.
 */

interface UsageDay { day: string; requests: number; failed: number }
interface ErrorDay { day: string; rate: number; failed?: number; requests?: number }
interface LatencyDay { day: string; first?: number | null; total?: number | null }

export function UsageTrendCard({
    trend,
    hasData,
    isLoading,
    error,
}: {
    trend: UsageDay[]
    hasData: boolean
    isLoading: boolean
    error: unknown
}) {
    return (
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
                            <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.08} />
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
                            <Bar dataKey="success" stackId="usage" fill={SERIES_COLORS[0]} />
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
    )
}

export function ErrorRateCard({
    errorTrend,
    hasData,
    isLoading,
}: {
    errorTrend: ErrorDay[]
    hasData: boolean
    isLoading: boolean
}) {
    return (
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
                        <AreaChart data={errorTrend} margin={{ left: -8, right: 8, top: 8, bottom: 0 }}>
                            <defs>
                                <linearGradient id="errGradient" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="var(--destructive)" stopOpacity={0.3} />
                                    <stop offset="95%" stopColor="var(--destructive)" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.08} />
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
                                    return [`${Number(value).toFixed(1)}%`, `${failed}/${requests}`]
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
    )
}

export function LatencyCard({
    latencyTrend,
    hasData,
    isLoading,
}: {
    latencyTrend: LatencyDay[]
    hasData: boolean
    isLoading: boolean
}) {
    return (
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
                        <LineChart data={latencyTrend} margin={{ left: -8, right: 8, top: 8, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.08} />
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
    )
}
