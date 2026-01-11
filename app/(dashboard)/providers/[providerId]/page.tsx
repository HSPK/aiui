"use client"

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { useParams, useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { ArrowLeft, ExternalLink, RefreshCcw, ShieldCheck, Globe, FileText } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ProviderIcon } from "@/components/ProviderIcon"
import { ModelCard } from "@/components/providers/model-card"
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "sonner"

export default function ProviderDetailPage() {
    const params = useParams()
    const router = useRouter()
    const providerId = params.providerId as string
    const queryClient = useQueryClient()

    const { data: provider, isLoading: isLoadingProvider } = useQuery({
        queryKey: ["provider", providerId],
        queryFn: () => api.getProvider(providerId),
        enabled: !!providerId,
    })

    const { data: models, isLoading: isLoadingModels } = useQuery({
        queryKey: ["provider-models", providerId],
        queryFn: () => api.getProviderModels(providerId),
        enabled: !!providerId,
    })

    const reloadMutation = useMutation({
        mutationFn: () => api.reloadProviders(), // Or maybe a specific reload for this provider if API supported it
        onSuccess: () => {
            toast.success("Provider reloaded successfully")
            queryClient.invalidateQueries({ queryKey: ["provider", providerId] })
            queryClient.invalidateQueries({ queryKey: ["provider-models", providerId] })
        },
        onError: (error) => {
            toast.error(`Failed to reload: ${error.message}`)
        },
    })

    if (isLoadingProvider) {
        return (
            <div className="space-y-6">
                <div className="flex items-center gap-4">
                    <Skeleton className="h-10 w-10 rounded-full" />
                    <div className="space-y-2">
                        <Skeleton className="h-8 w-64" />
                        <Skeleton className="h-4 w-32" />
                    </div>
                </div>
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                    {[1, 2, 3].map((i) => (
                        <Skeleton key={i} className="h-40 rounded-xl" />
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

    return (
        <div className="h-full overflow-y-auto space-y-8 p-4">
            {/* Header / Nav */}
            <div className="flex items-center justify-between">
                <Button variant="ghost" className="pl-0 hover:bg-transparent" onClick={() => router.push("/providers")}>
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Back
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => reloadMutation.mutate()}
                    disabled={reloadMutation.isPending}
                >
                    <RefreshCcw className={`mr-2 h-3.5 w-3.5 ${reloadMutation.isPending ? "animate-spin" : ""}`} />
                    Refresh Data
                </Button>
            </div>

            {/* Provider Info Section */}
            <div className="flex flex-col md:flex-row gap-6 md:items-start mr-4 ml-4 justify-between">
                <div className="flex-1 space-y-4">
                    <div className="flex items-center gap-4">
                        <div className="h-16 w-16 bg-muted/30 rounded-xl flex items-center justify-center border">
                            <ProviderIcon
                                providerName={provider.provider_name}
                                className="h-10 w-10"
                                width={40}
                                height={40}
                            />
                        </div>
                        <div>
                            <h1 className="text-3xl font-bold tracking-tight">{provider.provider_name}</h1>
                            <div className="flex items-center gap-2 mt-1.5">
                                <Badge variant="secondary" className="gap-1 rounded-sm px-2 font-normal">
                                    <ShieldCheck className="h-3 w-3 text-green-500" />
                                    Operational
                                </Badge>
                                <span className="text-muted-foreground">•</span>
                                <span className="text-sm text-muted-foreground font-mono">
                                    {models?.length || 0} Models Available
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Quick Actions / Links */}
                <div className="flex flex-col items-end gap-3 md:justify-end">
                    <div className="flex flex-wrap gap-2 justify-end">
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

                    <Badge variant="outline" className="font-mono font-normal text-xs text-muted-foreground">
                        endpoint: {provider.proxy || "Standard"}
                    </Badge>
                </div>
            </div>

            {/* Models List Section */}
            <div className="space-y-4">
                {isLoadingModels ? (
                    <div className="flex flex-col gap-4">
                        {[1, 2, 3, 4].map((i) => (
                            <Card key={i} className="h-24 w-full p-6 flex flex-col justify-center space-y-3">
                                <Skeleton className="h-5 w-1/4" />
                                <Skeleton className="h-4 w-1/2" />
                            </Card>
                        ))}
                    </div>
                ) : models && models.length > 0 ? (
                    <div className="flex flex-col gap-4">
                        {models.map((model) => (
                            <ModelCard key={model.name} model={model} />
                        ))}
                    </div>
                ) : (
                    <div className="text-center py-12 border-2 border-dashed rounded-lg">
                        <p className="text-muted-foreground">No models found for this provider.</p>
                    </div>
                )}
            </div>
        </div>
    )
}
