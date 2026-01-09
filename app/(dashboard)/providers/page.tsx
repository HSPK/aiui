"use client"

import * as React from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { ProviderConfig, ModelConfig } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { toast } from "sonner"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { RefreshCcw, FileText, BookOpen, ChevronRight, Copy } from "lucide-react"
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip"

export default function ProvidersPage() {
    const queryClient = useQueryClient()

    const { data: providers, isLoading: isLoadingProviders, refetch: refetchProviders } = useQuery({
        queryKey: ["providers"],
        queryFn: api.getProviders,
    })

    const { data: models, isLoading: isLoadingModels } = useQuery({
        queryKey: ["models"],
        queryFn: api.getModels,
    })

    const reloadMutation = useMutation({
        mutationFn: api.reloadProviders,
        onSuccess: () => {
            toast.success("Providers reloaded successfully")
            queryClient.invalidateQueries({ queryKey: ["providers"] })
            queryClient.invalidateQueries({ queryKey: ["models"] })
        },
        onError: (error) => {
            toast.error(`Failed to reload providers: ${error.message}`)
        },
    })

    return (
        <div className="space-y-6">
            <h2 className="text-3xl font-bold tracking-tight">Providers & Models</h2>

            <Tabs defaultValue="providers" className="w-full">
                <div className="flex items-center gap-2">
                    <TabsList>
                        <TabsTrigger value="providers">Providers</TabsTrigger>
                        <TabsTrigger value="models">Models</TabsTrigger>
                    </TabsList>
                    <Button
                        variant="outline"
                        size="icon-sm"
                        onClick={() => reloadMutation.mutate()}
                        disabled={reloadMutation.isPending}
                    >
                        <RefreshCcw className={`h-2 w-2 ${reloadMutation.isPending ? "animate-spin" : ""}`} />
                    </Button>
                </div>

                <TabsContent value="providers" className="mt-4">
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                        {isLoadingProviders ? (
                            <p className="text-muted-foreground">Loading providers...</p>
                        ) : providers?.map((provider) => (
                            <ProviderCard
                                key={provider.provider_name}
                                provider={provider}
                            />
                        ))}
                        {!isLoadingProviders && providers?.length === 0 && (
                            <p className="text-muted-foreground col-span-full">No providers configured.</p>
                        )}
                    </div>
                </TabsContent>

                <TabsContent value="models" className="mt-4">
                    <Card>
                        <CardHeader>
                            <CardTitle>Model Registry</CardTitle>
                            <CardDescription>All available models across configured providers.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            {isLoadingModels ? (
                                <p className="text-muted-foreground">Loading models...</p>
                            ) : (
                                <ModelsTable models={models || []} />
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    )
}

function ProviderCard({
    provider,
}: {
    provider: ProviderConfig,
}) {
    return (
        <Card
            className="group relative transition-all duration-300 hover:shadow-lg border-muted/60 hover:border-primary/20 cursor-pointer bg-card flex flex-col justify-between"
        >
            <CardContent>
                <div className="flex justify-between items-start mb-2">
                    <div className="flex items-center gap-4">
                        {/* Logo Placeholder */}
                        <div className="h-10 w-10 rounded-lg bg-primary/5 flex items-center justify-center border border-primary/10 group-hover:bg-primary/10 transition-colors">
                            <span className="text-sm font-bold text-primary/80">{provider.provider_name.substring(0, 2).toUpperCase()}</span>
                        </div>

                        <div className="space-y-1">
                            <h3 className="font-bold text-base leading-none tracking-tight">{provider.provider_name}</h3>
                            <div className="flex items-center gap-2">
                                {/* Status Indicator */}
                                <div className="flex items-center gap-1.5">
                                    <span className="h-1 w-1 rounded-full ring-1 ring-offset-1 transition-colors duration-300 bg-green-500 ring-green-200" />
                                    <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
                                        Operational
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="text-right">
                        <div className="text-2xl font-bold tracking-tight text-foreground">{provider.n_models || 0}</div>
                        <div className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest mt-0.5">Models</div>
                    </div>
                </div>

                <div className="flex items-end justify-between">
                    <div className="flex flex-col gap-3">
                        {/* Action Icons */}
                        <div className="flex gap-3">
                            {provider.model_page ? (
                                <a
                                    href={provider.model_page}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-muted-foreground/60 hover:text-primary transition-colors p-0.5"
                                    onClick={(e) => e.stopPropagation()}
                                    title="View Models"
                                >
                                    <FileText className="h-4 w-4" strokeWidth={1.5} />
                                </a>
                            ) : <FileText className="h-4 w-4 text-muted-foreground/20 cursor-not-allowed" strokeWidth={1.5} />}

                            {provider.document_page ? (
                                <a
                                    href={provider.document_page}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-muted-foreground/60 hover:text-primary transition-colors p-0.5"
                                    onClick={(e) => e.stopPropagation()}
                                    title="Documentation"
                                >
                                    <BookOpen className="h-4 w-4" strokeWidth={1.5} />
                                </a>
                            ) : <BookOpen className="h-4 w-4 text-muted-foreground/20 cursor-not-allowed" strokeWidth={1.5} />}
                        </div>

                        {/* Capability Badges / Endpoint */}
                        <Badge
                            variant="outline"
                            className="font-mono font-normal text-[10px] text-muted-foreground/60 group-hover:text-foreground group-hover:border-primary/20 cursor-default transition-colors h-5 px-1.5 max-w-[160px] truncate block w-fit"
                            title={`Endpoint: ${provider.proxy}`}
                            onClick={(e) => e.stopPropagation()}
                        >
                            {provider.proxy}
                        </Badge>
                    </div>

                    {/* Arrow */}
                    <div className="opacity-0 group-hover:opacity-100 transition-all duration-300 transform -translate-x-2 group-hover:translate-x-0 pb-0.5">
                        <ChevronRight className="h-4 w-4 text-muted-foreground/80" />
                    </div>
                </div>
            </CardContent>
        </Card>
    )
}

function ModelsTable({ models }: { models: ModelConfig[] }) {
    return (
        <Table>
            <TableHeader>
                <TableRow>
                    <TableHead>Model Name</TableHead>
                    <TableHead>ID</TableHead>
                    <TableHead>Provider</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Context</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {models.map((model) => (
                    <TableRow key={model.name}>
                        <TableCell className="font-mono max-w-[300px]">
                            <div className="flex items-center justify-between gap-2 group w-full">
                                <TooltipProvider>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <span className="truncate cursor-default">{model.name}</span>
                                        </TooltipTrigger>
                                        <TooltipContent side="right" className="max-w-[300px] break-all">
                                            <p className="font-mono text-xs">{model.name}</p>
                                        </TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                                    onClick={() => {
                                        navigator.clipboard.writeText(model.name)
                                        toast.success("Model name copied to clipboard")
                                    }}
                                >
                                    <Copy className="h-3 w-3 text-muted-foreground" />
                                </Button>
                            </div>
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{model.model_id}</TableCell>
                        <TableCell>
                            <Badge variant="outline">{model.provider}</Badge>
                        </TableCell>
                        <TableCell>
                            <Badge variant="outline">{model.type}</Badge>
                        </TableCell>
                        <TableCell>
                            <Badge variant="outline">
                                {model.context_window
                                    ? (model.context_window >= 1000
                                        ? `${Math.round(model.context_window / 1000)}k`
                                        : model.context_window.toLocaleString())
                                    : '-'}
                            </Badge>
                        </TableCell>
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    )
}

