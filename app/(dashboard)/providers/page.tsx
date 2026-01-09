"use client"

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { ProviderConfig, ModelConfig } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { toast } from "sonner"
import { RefreshCcw, Search, ArrowUpDown } from "lucide-react"
import { Input } from "@/components/ui/input"
import { useState } from "react"
import { useRouter } from "next/navigation"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { ProviderCard } from "@/components/providers/provider-card"
import { ModelsTable } from "@/components/providers/models-table"

export default function ProvidersPage() {
    const router = useRouter()
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
                                onClick={() => router.push(`/providers/${provider.provider_name}`)}
                            />
                        ))}
                        {!isLoadingProviders && filteredProviders.length === 0 && (
                            <div className="col-span-full flex flex-col items-center justify-center border-2 border-dashed rounded-lg h-[calc(100vh-220px)] text-muted-foreground">
                                <Search className="h-8 w-8 mb-4 opacity-50" />
                                <p className="text-lg font-medium">No providers found matching your search.</p>
                            </div>
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



