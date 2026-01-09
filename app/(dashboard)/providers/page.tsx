"use client"

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { ProviderConfig, ModelConfig } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
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
import { ProviderIcon } from "@/components/ProviderIcon"
import { Input } from "@/components/ui/input"
import { Search, ArrowUpDown } from "lucide-react"
import { useState } from "react"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"

export default function ProvidersPage() {
    const queryClient = useQueryClient()
    const [searchQuery, setSearchQuery] = useState("")
    const [activeTab, setActiveTab] = useState("providers")
    const [sortOrder, setSortOrder] = useState("default")

    const { data: providers, isLoading: isLoadingProviders, refetch: refetchProviders } = useQuery({
        queryKey: ["providers"],
        queryFn: api.getProviders,
    })

    const { data: models, isLoading: isLoadingModels } = useQuery({
        queryKey: ["models"],
        queryFn: api.getModels,
    })

    const getSortedProviders = (providers: ProviderConfig[]) => {
        const p = [...providers]
        if (sortOrder === "name") {
            p.sort((a, b) => a.provider_name.localeCompare(b.provider_name))
        } else if (sortOrder === "models") {
            p.sort((a, b) => (b.n_models || 0) - (a.n_models || 0))
        }
        return p
    }

    const getSortedModels = (models: ModelConfig[]) => {
        const m = [...models]
        if (sortOrder === "name") {
            m.sort((a, b) => a.name.localeCompare(b.name))
        } else if (sortOrder === "type") {
            m.sort((a, b) => a.type.localeCompare(b.type))
        } else if (sortOrder === "provider") {
            m.sort((a, b) => (a.provider || "").localeCompare(b.provider || ""))
        } else if (sortOrder === "context") {
            m.sort((a, b) => (b.context_window || 0) - (a.context_window || 0))
        }
        return m
    }

    const filteredProviders = providers ? getSortedProviders(providers).filter(p =>
        p.provider_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.proxy || "").toLowerCase().includes(searchQuery.toLowerCase())
    ) : []

    const filteredModels = models ? getSortedModels(models).filter(m =>
        m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (m.model_id || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        (m.provider || "").toLowerCase().includes(searchQuery.toLowerCase())
    ) : []

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

            <Tabs defaultValue="providers" className="w-full" onValueChange={setActiveTab}>
                <div className="flex items-center justify-between pb-4">
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
                    <div className="flex items-center gap-2">
                        <div className="text-sm text-muted-foreground mr-2">
                            {activeTab === "providers"
                                ? `Showing ${filteredProviders.length} providers`
                                : `Showing ${filteredModels.length} models`
                            }
                        </div>
                        <Select value={sortOrder} onValueChange={setSortOrder}>
                            <SelectTrigger className="w-[140px] h-9">
                                <ArrowUpDown className="mr-2 h-4 w-4 text-muted-foreground" />
                                <SelectValue placeholder="Sort by" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="default">Default</SelectItem>
                                {activeTab === "providers" ? (
                                    <>
                                        <SelectItem value="name">Name</SelectItem>
                                        <SelectItem value="models">Total Models</SelectItem>
                                    </>
                                ) : (
                                    <>
                                        <SelectItem value="name">Name</SelectItem>
                                        <SelectItem value="type">Type</SelectItem>
                                        <SelectItem value="provider">Provider</SelectItem>
                                        <SelectItem value="context">Context Window</SelectItem>
                                    </>
                                )}
                            </SelectContent>
                        </Select>
                        <div className="relative w-64">
                            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Search..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-8 h-9"
                            />
                        </div>
                    </div>
                </div>

                <TabsContent value="providers" className="mt-0">
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                        {isLoadingProviders ? (
                            <p className="text-muted-foreground">Loading providers...</p>
                        ) : filteredProviders.map((provider) => (
                            <ProviderCard
                                key={provider.provider_name}
                                provider={provider}
                            />
                        ))}
                        {!isLoadingProviders && filteredProviders.length === 0 && (
                            <p className="text-muted-foreground col-span-full">No providers found matching your search.</p>
                        )}
                    </div>
                </TabsContent>

                <TabsContent value="models" className="mt-0">
                    <Card>
                        <CardContent className="p-0 pt-0 pl-4 pr-4">
                            {isLoadingModels ? (
                                <p className="text-muted-foreground p-6">Loading models...</p>
                            ) : (
                                <ModelsTable models={filteredModels} />
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
                        <div className="h-10 w-10 shrink-0 flex items-center justify-center">
                            <ProviderIcon
                                providerName={provider.provider_name}
                                className="h-10 w-10 text-lg"
                                width={30}
                                height={30}
                            />
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
                                        <TooltipContent side="right" className="break-all">
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

