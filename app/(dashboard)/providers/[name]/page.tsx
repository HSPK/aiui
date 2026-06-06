"use client"

import { providers } from "@/lib/api";

import { useParams, useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { ArrowLeft, RefreshCcw, Globe, FileText, Activity } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { ProviderIcon } from "@/components/ProviderIcon"
import { ModelCard } from "@/components/providers/model-card"
import { ProviderHealthPill } from "@/components/providers/provider-health-pill"
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "sonner"

export default function ProviderDetailPage() {
    const params = useParams()
    const router = useRouter()
    // Folder is named [name] so the URL segment is the provider's stable
    // human-readable name. The server route accepts either id or name so
    // legacy URLs with UUIDs still resolve.
    const slug = decodeURIComponent(params.name as string)

    const { data: provider, isLoading: isLoadingProvider } = providers.useGet(slug)
    const { data: models, isLoading: isLoadingModels } = providers.useModels(slug)

    const refreshMutation = providers.useReload({
        onSuccess: () => toast.success("Refreshed model list"),
        onError: (error) => toast.error(`Refresh failed: ${error.message}`),
    })

    const checkMutation = providers.useCheck(slug, {
        onSuccess: (res) => {
            if (res.ok) toast.success(`Healthy${res.latency_ms != null ? ` (${res.latency_ms}ms)` : ""}`)
            else toast.error(`Down: ${res.error ?? "unknown"}`)
        },
        onError: (e) => toast.error(`Health check failed: ${e.message}`),
    })

    if (isLoadingProvider) {
        return (
            <div className="h-full overflow-y-auto scrollbar-thin space-y-6 p-4">
                <div className="flex items-center gap-4">
                    <Skeleton className="h-10 w-10 rounded-full" />
                    <div className="space-y-2">
                        <Skeleton className="h-8 w-64" />
                        <Skeleton className="h-4 w-32" />
                    </div>
                </div>
                <div className="space-y-3">
                    {[1, 2, 3, 4].map((i) => (
                        <Skeleton key={i} className="h-24 rounded-xl" />
                    ))}
                </div>
            </div>
        )
    }

    if (!provider) {
        return (
            <div className="flex flex-col items-center justify-center h-[50vh] gap-4">
                <h2 className="text-2xl font-bold">Provider not found</h2>
                <Button onClick={() => router.push("/providers")}>
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Back to Providers
                </Button>
            </div>
        )
    }

    const dbCount = models?.filter((m) => !m.is_discovered).length ?? 0
    const discoveredCount = models?.filter((m) => m.is_discovered).length ?? 0

    return (
        <div className="h-full overflow-y-auto scrollbar-thin space-y-6 p-4">
            {/* Back / Refresh row */}
            <div className="flex items-center justify-between">
                <Button variant="ghost" className="pl-0 hover:bg-transparent" onClick={() => router.push("/providers")}>
                    <ArrowLeft className="mr-2 h-4 w-4" /> Back
                </Button>
                <div className="flex items-center gap-2">
                    {provider.health_check_url && (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => checkMutation.mutate()}
                            disabled={checkMutation.isPending}
                            title="Run the configured health check now"
                        >
                            <Activity className={`mr-2 h-3.5 w-3.5 ${checkMutation.isPending ? "animate-pulse" : ""}`} />
                            Check Health
                        </Button>
                    )}
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => refreshMutation.mutate()}
                        disabled={refreshMutation.isPending}
                    >
                        <RefreshCcw className={`mr-2 h-3.5 w-3.5 ${refreshMutation.isPending ? "animate-spin" : ""}`} />
                        Refresh Models
                    </Button>
                </div>
            </div>

            {/* Provider header */}
            <div className="flex flex-col md:flex-row gap-6 md:items-start md:justify-between">
                <div className="flex items-center gap-4 min-w-0">
                    <div className="h-16 w-16 bg-muted/30 rounded-xl flex items-center justify-center border shrink-0">
                        <ProviderIcon providerName={provider.provider_name} className="h-10 w-10" width={40} height={40} />
                    </div>
                    <div className="min-w-0">
                        <h1 className="text-3xl font-bold tracking-tight truncate" title={provider.provider_name}>{provider.provider_name}</h1>
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                            <ProviderHealthPill provider={provider} size="md" />
                            {provider.adapter_id && provider.adapter_id !== "openai" && (
                                <Badge variant="outline" className="text-[10px] uppercase tracking-wider font-semibold">{provider.adapter_id.replace(/^azure-/, "Azure ")}</Badge>
                            )}
                            <span className="text-sm text-muted-foreground font-mono">
                                {(models?.length ?? 0)} model{(models?.length ?? 0) === 1 ? "" : "s"} ({discoveredCount} discovered, {dbCount} override{dbCount === 1 ? "" : "s"})
                            </span>
                        </div>
                    </div>
                </div>

                <div className="flex flex-col items-start md:items-end gap-3 shrink-0">
                    <div className="flex flex-wrap gap-2 md:justify-end">
                        {provider.model_page && (
                            <Button variant="outline" size="sm" asChild>
                                <a href={provider.model_page} target="_blank" rel="noreferrer">
                                    <Globe className="mr-2 h-3.5 w-3.5" />
                                    Model Page
                                </a>
                            </Button>
                        )}
                        {provider.document_page && (
                            <Button variant="outline" size="sm" asChild>
                                <a href={provider.document_page} target="_blank" rel="noreferrer">
                                    <FileText className="mr-2 h-3.5 w-3.5" />
                                    Documentation
                                </a>
                            </Button>
                        )}
                    </div>
                    <Badge variant="outline" className="font-mono font-normal text-xs text-muted-foreground max-w-full truncate">
                        endpoint: {provider.proxy || "Standard"}
                    </Badge>
                </div>
            </div>

            {/* Models list */}
            <div className="space-y-3">
                {isLoadingModels ? (
                    <div className="flex flex-col gap-3">
                        {[1, 2, 3, 4].map((i) => (
                            <Card key={i} className="h-24 w-full p-6 space-y-3">
                                <Skeleton className="h-5 w-1/4" />
                                <Skeleton className="h-4 w-1/2" />
                            </Card>
                        ))}
                    </div>
                ) : models && models.length > 0 ? (
                    <div className="flex flex-col gap-3">
                        {models.map((model) => (
                            <ModelCard key={`${model.is_discovered ? "d" : "o"}:${model.name}`} model={model} />
                        ))}
                    </div>
                ) : (
                    <div className="text-center py-12 border-2 border-dashed rounded-lg">
                        <p className="text-muted-foreground mb-3">No models exposed by this provider yet.</p>
                        <Button variant="outline" size="sm" onClick={() => refreshMutation.mutate()} disabled={refreshMutation.isPending}>
                            <RefreshCcw className={`mr-2 h-3.5 w-3.5 ${refreshMutation.isPending ? "animate-spin" : ""}`} /> Refresh Models
                        </Button>
                    </div>
                )}
            </div>
        </div>
    )
}
