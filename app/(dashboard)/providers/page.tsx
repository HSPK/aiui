"use client"

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
import { RefreshCcw, CheckCircle2, XCircle, Globe, FileText, Server } from "lucide-react"

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

    const checkProviderMutation = useMutation({
        mutationFn: api.checkProvider,
        onSuccess: (_, variables) => {
            toast.success(`Provider ${variables} is healthy`)
        },
        onError: (error, variables) => {
            toast.error(`Provider ${variables} health check failed: ${error.message}`)
        }
    })

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h2 className="text-3xl font-bold tracking-tight">Providers & Models</h2>
                <Button
                    variant="outline"
                    onClick={() => reloadMutation.mutate()}
                    disabled={reloadMutation.isPending}
                >
                    <RefreshCcw className={`mr-2 h-4 w-4 ${reloadMutation.isPending ? "animate-spin" : ""}`} />
                    Reload Config
                </Button>
            </div>

            <Tabs defaultValue="providers" className="w-full">
                <TabsList>
                    <TabsTrigger value="providers">Providers</TabsTrigger>
                    <TabsTrigger value="models">Models</TabsTrigger>
                </TabsList>

                <TabsContent value="providers" className="mt-4">
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                        {isLoadingProviders ? (
                            <p className="text-muted-foreground">Loading providers...</p>
                        ) : providers?.map((provider) => (
                            <ProviderCard
                                key={provider.provider_name}
                                provider={provider}
                                onCheck={(id) => checkProviderMutation.mutate(id)}
                                isChecking={checkProviderMutation.isPending && checkProviderMutation.variables === provider.provider_name}
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
    onCheck,
    isChecking
}: {
    provider: ProviderConfig,
    onCheck: (id: string) => void,
    isChecking: boolean
}) {
    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="font-bold flex items-center gap-2">
                    {provider.provider_name}
                    {provider.is_local && <Badge variant="secondary" className="text-xs">Local</Badge>}
                </CardTitle>
                <Server className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="mt-4 space-y-2">
                <div className="grid grid-cols-3 gap-2 text-sm">
                    <span className="font-medium text-muted-foreground">Proxy:</span>
                    <span className="col-span-2 font-mono text-xs bg-muted px-1 py-0.5 rounded truncate" title={provider.proxy}>
                        {provider.proxy}
                    </span>
                </div>

                <div className="flex gap-2 text-xs pt-2">
                    {provider.model_page && (
                        <a href={provider.model_page} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-blue-500 hover:underline">
                            <Globe className="h-3 w-3" /> Models
                        </a>
                    )}
                    {provider.document_page && (
                        <a href={provider.document_page} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-blue-500 hover:underline">
                            <FileText className="h-3 w-3" /> Docs
                        </a>
                    )}
                </div>
            </CardContent>
            <CardFooter>
                <Button
                    variant="ghost"
                    size="sm"
                    className="w-full"
                    onClick={() => onCheck(provider.provider_name)} // API typically uses ID, but schema assumes provider_name? Using proxy or name as ID needs clarification. Usually REST uses ID.
                    disabled={isChecking}
                >
                    {isChecking ? <RefreshCcw className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                    Check Health
                </Button>
            </CardFooter>
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
                    <TableHead className="text-right">Timeout</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {models.map((model) => (
                    <TableRow key={model.name}>
                        <TableCell className="font-medium">{model.name}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{model.model_id}</TableCell>
                        <TableCell>
                            <Badge variant="outline">{model.provider}</Badge>
                        </TableCell>
                        <TableCell>{model.type}</TableCell>
                        <TableCell>{model.context_window?.toLocaleString() || '-'}</TableCell>
                        <TableCell className="text-right">{model.timeout}s</TableCell>
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    )
}
