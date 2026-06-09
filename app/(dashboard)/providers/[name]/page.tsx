"use client"

import * as React from "react"
import { useParams, useRouter } from "next/navigation"
import {
    Activity,
    ArrowLeft,
    ChevronLeft,
    FileText,
    Globe,
    Plus,
    RefreshCcw,
} from "lucide-react"
import { toast } from "sonner"

import { models as modelsApi } from "@/lib/api/models"
import { providers } from "@/lib/api/providers"
import { useAuth } from "@/context/auth-context"
import type { ModelDTO } from "@/lib/schemas/model"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { ProviderIcon } from "@/components/ProviderIcon"
import { ModelsTable } from "@/components/providers/models-table"
import { ModelFormDialog } from "@/components/providers/model-form-dialog"
import { ProviderHealthPill } from "@/components/providers/provider-health-pill"

type ModelDialogState = {
    open: boolean
    mode: "create" | "edit"
    model?: ModelDTO | null
}

export default function ProviderDetailPage() {
    const params = useParams()
    const router = useRouter()
    const slug = decodeURIComponent(String(params.name ?? ""))

    const { user } = useAuth()
    const isAdmin = user?.role === "admin"

    const { data: provider, isLoading: isLoadingProvider } = providers.useGet(slug)
    const { data: models, isLoading: isLoadingModels } = providers.useModels(slug)

    const [deleting, setDeleting] = React.useState<ModelDTO | null>(null)
    const [modelDialog, setModelDialog] = React.useState<ModelDialogState>({
        open: false,
        mode: "create",
        model: null,
    })

    const refreshMutation = providers.useReload({
        onSuccess: () => toast.success("Refreshed model list"),
        onError: (error) => toast.error(`Refresh failed: ${error.message}`),
    })

    const checkMutation = providers.useCheck(slug, {
        onSuccess: (res) => {
            if (res.ok)
                toast.success(
                    `Healthy${res.latency_ms != null ? ` (${res.latency_ms}ms)` : ""}`
                )
            else toast.error(`Down: ${res.error ?? "unknown"}`)
        },
        onError: (e) => toast.error(`Health check failed: ${e.message}`),
    })

    const deleteMutation = modelsApi.useDelete({
        onSuccess: () => {
            toast.success("Model deleted")
            setDeleting(null)
        },
        onError: (e) => toast.error(e.message || "Delete failed"),
    })

    if (isLoadingProvider) {
        return <ProviderDetailSkeleton />
    }

    if (!provider) {
        return (
            <div className="flex flex-col items-center justify-center h-[50vh] gap-4">
                <h2 className="text-lg font-semibold">Provider not found</h2>
                <Button onClick={() => router.push("/providers")} size="sm">
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Back to Providers
                </Button>
            </div>
        )
    }

    const dbCount = models?.filter((m) => !m.is_discovered).length ?? 0
    const discoveredCount = models?.filter((m) => m.is_discovered).length ?? 0
    const totalModels = models?.length ?? 0

    return (
        <div className="h-full overflow-y-auto">
            <div className="mx-auto w-full max-w-7xl space-y-4 p-4 md:p-6">
                <button
                    onClick={() => router.push("/providers")}
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                    <ChevronLeft className="h-3 w-3" />
                    Providers
                </button>

                {/* Identity */}
                <Card className="p-4 md:p-5">
                    <div className="flex items-start gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted shrink-0">
                            <ProviderIcon
                                providerName={provider.provider_name}
                                className="h-6 w-6"
                                width={24}
                                height={24}
                            />
                        </div>
                        <div className="min-w-0 flex-1 space-y-2">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                                <h1
                                    className="text-lg font-semibold tracking-tight truncate min-w-0"
                                    title={provider.provider_name}
                                >
                                    {provider.provider_name}
                                </h1>
                                <div className="flex flex-wrap items-center gap-2 shrink-0">
                                    {provider.model_page && (
                                        <Button variant="outline" size="sm" asChild>
                                            <a href={provider.model_page} target="_blank" rel="noreferrer">
                                                <Globe className="mr-1.5 h-3.5 w-3.5" />
                                                Models
                                            </a>
                                        </Button>
                                    )}
                                    {provider.document_page && (
                                        <Button variant="outline" size="sm" asChild>
                                            <a href={provider.document_page} target="_blank" rel="noreferrer">
                                                <FileText className="mr-1.5 h-3.5 w-3.5" />
                                                Docs
                                            </a>
                                        </Button>
                                    )}
                                    {provider.health_check_url && (
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => checkMutation.mutate()}
                                            disabled={checkMutation.isPending}
                                            title="Run the configured health check now"
                                        >
                                            <Activity
                                                className={`mr-1.5 h-3.5 w-3.5 ${checkMutation.isPending ? "animate-pulse" : ""}`}
                                            />
                                            Check
                                        </Button>
                                    )}
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => refreshMutation.mutate()}
                                        disabled={refreshMutation.isPending}
                                    >
                                        <RefreshCcw
                                            className={`mr-1.5 h-3.5 w-3.5 ${refreshMutation.isPending ? "animate-spin" : ""}`}
                                        />
                                        Refresh
                                    </Button>
                                </div>
                            </div>
                            <div className="flex items-center gap-1.5 flex-wrap">
                                <ProviderHealthPill provider={provider} size="sm" />
                                {provider.adapter_id && provider.adapter_id !== "openai" && (
                                    <Badge
                                        variant="outline"
                                        className="text-[10px] uppercase tracking-wider font-semibold"
                                    >
                                        {provider.adapter_id.replace(/^azure-/, "Azure ")}
                                    </Badge>
                                )}
                                <span className="text-xs text-muted-foreground">
                                    {totalModels} model{totalModels === 1 ? "" : "s"} ·{" "}
                                    {discoveredCount} discovered ·{" "}
                                    {dbCount} override{dbCount === 1 ? "" : "s"}
                                </span>
                            </div>
                            {provider.proxy && (
                                <div className="pt-2 mt-1 border-t flex items-center gap-2 text-xs text-muted-foreground">
                                    <span className="uppercase tracking-wider text-[10px] font-semibold shrink-0">
                                        Endpoint
                                    </span>
                                    <code className="font-mono truncate min-w-0">{provider.proxy}</code>
                                </div>
                            )}
                        </div>
                    </div>
                </Card>

                {/* Models — header + add button + table */}
                <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                        <h2 className="text-sm font-semibold tracking-tight">Models</h2>
                        {isAdmin && (
                            <Button
                                size="sm"
                                variant="secondary"
                                onClick={() =>
                                    setModelDialog({
                                        open: true,
                                        mode: "create",
                                        model: null,
                                    })
                                }
                            >
                                <Plus className="h-3.5 w-3.5 mr-1" />
                                Add model
                            </Button>
                        )}
                    </div>

                    {isLoadingModels ? (
                        <div className="border rounded-xl bg-card overflow-hidden">
                            <Skeleton className="h-64 rounded-none" />
                        </div>
                    ) : models && models.length > 0 ? (
                        <div className="border rounded-xl bg-card shadow-sm overflow-hidden">
                            <ModelsTable
                                models={models}
                                onEdit={isAdmin ? (m) =>
                                    setModelDialog({
                                        open: true,
                                        mode: m.is_discovered ? "create" : "edit",
                                        model: m,
                                    }) : undefined}
                                onDelete={isAdmin ? setDeleting : undefined}
                            />
                        </div>
                    ) : (
                        <div className="text-center py-12 border border-dashed rounded-lg">
                            <p className="text-sm text-muted-foreground mb-3">
                                No models exposed by this provider yet.
                            </p>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => refreshMutation.mutate()}
                                disabled={refreshMutation.isPending}
                            >
                                <RefreshCcw
                                    className={`mr-2 h-3.5 w-3.5 ${refreshMutation.isPending ? "animate-spin" : ""}`}
                                />
                                Refresh Models
                            </Button>
                        </div>
                    )}
                </div>

                <ConfirmDialog
                    open={!!deleting}
                    onOpenChange={(o) => !o && setDeleting(null)}
                    title="Delete model?"
                    description={<>This will permanently delete model <b>{deleting?.name}</b>. This cannot be undone.</>}
                    confirmLabel="Delete"
                    destructive
                    isLoading={deleteMutation.isPending}
                    onConfirm={() => deleting && deleteMutation.mutate(deleting.id)}
                />

                <ModelFormDialog
                    open={modelDialog.open}
                    onOpenChange={(open) => setModelDialog((s) => ({ ...s, open }))}
                    mode={modelDialog.mode}
                    model={modelDialog.model}
                    defaultProviderId={provider.id}
                />
            </div>
        </div>
    )
}

function ProviderDetailSkeleton() {
    return (
        <div className="h-full overflow-y-auto">
            <div className="mx-auto w-full max-w-7xl space-y-4 p-4 md:p-6">
                <Skeleton className="h-3 w-20" />
                <Card className="p-4 md:p-5">
                    <div className="flex items-center gap-4">
                        <Skeleton className="h-10 w-10 rounded-lg" />
                        <div className="flex-1 space-y-2">
                            <Skeleton className="h-5 w-48" />
                            <Skeleton className="h-3 w-72" />
                        </div>
                    </div>
                </Card>
                <Skeleton className="h-64 rounded-xl" />
            </div>
        </div>
    )
}
