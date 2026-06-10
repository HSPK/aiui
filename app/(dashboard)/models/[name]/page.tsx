"use client"

import * as React from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import {
    Activity,
    AlertCircle,
    Bot,
    ChevronLeft,
    Clock,
    MessageSquare,
    Pencil,
    Zap,
} from "lucide-react"

import { models as modelsApi } from "@/lib/api/models"
import { providers } from "@/lib/api/providers"
import { stats } from "@/lib/api/stats"
import { useAuth } from "@/context/auth-context"
import { usePlaygroundStore } from "@/lib/stores/playground-store"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Kpi, StatsToolbar, compactNumber, formatLatency } from "@/components/dashboard/shared"
import { ProviderIcon } from "@/components/ProviderIcon"
import { ModelConfigPanel } from "@/components/models/model-config-panel"
import { ModelFormDialog } from "@/components/providers/model-form-dialog"
import { ErrorRateCard, LatencyCard, UsageTrendCard } from "./_parts/charts"

export default function ModelDashboardPage() {
    const params = useParams()
    const router = useRouter()
    const { user } = useAuth()
    const isAdmin = user?.role === "admin"
    const modelName = decodeURIComponent(String(params.name ?? ""))
    const [days, setDays] = React.useState(14)
    const [modelDialog, setModelDialog] = React.useState(false)
    const { data, isLoading, isFetching, error } = stats.useModel(modelName, { days })
    const { data: modelDetail } = modelsApi.useGet(modelName)
    const { data: providerDetail } = providers.useGet(modelDetail?.provider_id ?? null)

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
                <Link
                    href="/"
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                    <ChevronLeft className="h-3 w-3" />
                    Dashboard
                </Link>

                {/* Identity card — narrow-screen safe: icon stays next to
                 *  the title block; badges/actions wrap inline; description
                 *  flows below at full width. */}
                <Card>
                    <CardContent className="p-4 md:p-5">
                        <div className="flex items-start gap-3">
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
                            <div className="min-w-0 flex-1 space-y-2">
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                    <h1
                                        className="text-lg font-semibold tracking-tight truncate min-w-0"
                                        title={modelName}
                                    >
                                        {modelName}
                                    </h1>
                                    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                                        {data?.capability === "chat" && (
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="outline"
                                                onClick={tryInPlayground}
                                            >
                                                <MessageSquare className="mr-1.5 h-3.5 w-3.5" />
                                                Try
                                            </Button>
                                        )}
                                        {isAdmin && modelDetail && !modelDetail.is_discovered && (
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() => setModelDialog(true)}
                                            >
                                                <Pencil className="mr-1.5 h-3.5 w-3.5" />
                                                Edit
                                            </Button>
                                        )}
                                        {isAdmin && modelDetail?.is_discovered && (
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() => setModelDialog(true)}
                                            >
                                                <Pencil className="mr-1.5 h-3.5 w-3.5" />
                                                Override
                                            </Button>
                                        )}
                                    </div>
                                </div>
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
                                    {modelDetail && (
                                        <Badge
                                            variant={modelDetail.is_discovered ? "secondary" : "default"}
                                            className="text-[10px] uppercase tracking-wider"
                                        >
                                            {modelDetail.is_discovered ? "discovered" : "override"}
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
                                        <p className="text-xs text-muted-foreground leading-relaxed">
                                            {data.description}
                                        </p>
                                    )
                                )}
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Configuration: effective params + raw upstream entry. */}
                {modelDetail && (
                    <ModelConfigPanel
                        model={modelDetail}
                        providerDefaults={
                            (providerDetail?.default_params ?? null) as Record<string, unknown> | null
                        }
                    />
                )}

                {/* Stats */}
                <StatsToolbar
                    windowStart={data?.window_start}
                    windowEnd={data?.window_end}
                    days={days}
                    onDaysChange={setDays}
                    isFetching={isFetching}
                />

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

                <UsageTrendCard trend={trend} hasData={hasData} isLoading={isLoading} error={error} />

                <div className="grid gap-4 lg:grid-cols-2">
                    <ErrorRateCard errorTrend={errorTrend} hasData={hasData} isLoading={isLoading} />
                    <LatencyCard latencyTrend={latencyTrend} hasData={hasData} isLoading={isLoading} />
                </div>
            </div>

            <ModelFormDialog
                open={modelDialog}
                onOpenChange={setModelDialog}
                mode={modelDetail?.is_discovered ? "create" : "edit"}
                model={modelDetail ?? null}
                onSaved={(saved) => {
                    // Promote (discovered → DB row) OR rename: the
                    // URL slug is based on `modelName`, so when the
                    // server-side name differs (either because it's
                    // a fresh DB row or the admin edited the field)
                    // we must navigate so the page doesn't 404 on
                    // re-fetch with the stale slug.
                    if (saved && saved.name !== modelName) {
                        router.replace(`/models/${encodeURIComponent(saved.name)}`)
                    }
                }}
            />
        </div>
    )
}
