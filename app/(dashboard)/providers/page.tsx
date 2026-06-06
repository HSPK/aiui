"use client"

import { models, providers } from "@/lib/api";
import type { ProviderDTO } from "@/lib/schemas/provider";
import type { ModelDTO } from "@/lib/schemas/model";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { toast } from "sonner"
import { RefreshCcw, Search, ArrowUpDown, Plus, Pencil, Trash2 } from "lucide-react"
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
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { ProviderCard } from "@/components/providers/provider-card"
import { ModelsTable } from "@/components/providers/models-table"
import { ProviderFormDialog } from "@/components/providers/provider-form-dialog"
import { ModelFormDialog } from "@/components/providers/model-form-dialog"
import { useAuth } from "@/context/auth-context"

export default function ProvidersPage() {
    const router = useRouter()
    const queryClient = useQueryClient()
    const { user } = useAuth()
    const isAdmin = user?.role === "admin"
    const [searchQuery, setSearchQuery] = useState("")
    const [activeTab, setActiveTab] = useState("providers")
    const [sortOrder, setSortOrder] = useState("default")

    const [providerDialog, setProviderDialog] = useState<{ open: boolean; mode: "create" | "edit"; provider?: ProviderDTO | null }>({ open: false, mode: "create" })
    const [modelDialog, setModelDialog] = useState<{ open: boolean; mode: "create" | "edit"; model?: ModelDTO | null }>({ open: false, mode: "create" })
    const [deleteProvider, setDeleteProvider] = useState<ProviderDTO | null>(null)
    const [deleteModel, setDeleteModel] = useState<ModelDTO | null>(null)

    const { data: providerList, isLoading: isLoadingProviders } = useQuery({
        queryKey: ["providers"],
        queryFn: providers.list,
    })

    const { data: modelList, isLoading: isLoadingModels } = useQuery({
        queryKey: ["models"],
        queryFn: models.list,
    })

    const getSortedProviders = (items: ProviderDTO[]) => {
        const p = [...items]
        if (sortOrder === "name") {
            p.sort((a, b) => a.provider_name.localeCompare(b.provider_name))
        } else if (sortOrder === "models") {
            p.sort((a, b) => (b.n_models || 0) - (a.n_models || 0))
        }
        return p
    }

    const getSortedModels = (items: ModelDTO[]) => {
        const m = [...items]
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

    const filteredProviders = providerList ? getSortedProviders(providerList).filter(p =>
        p.provider_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.proxy || "").toLowerCase().includes(searchQuery.toLowerCase())
    ) : []

    const filteredModels = modelList ? getSortedModels(modelList).filter(m =>
        m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (m.model_id || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        (m.provider || "").toLowerCase().includes(searchQuery.toLowerCase())
    ) : []

    const reloadMutation = useMutation({
        mutationFn: providers.reload,
        onSuccess: () => {
            toast.success("Refreshed")
            queryClient.invalidateQueries({ queryKey: ["providers"] })
            queryClient.invalidateQueries({ queryKey: ["models"] })
        },
        onError: (error) => {
            toast.error(`Refresh failed: ${error.message}`)
        },
    })

    const deleteProviderMutation = useMutation({
        mutationFn: (id: string) => providers.remove(id),
        onSuccess: () => {
            toast.success("Provider deleted")
            queryClient.invalidateQueries({ queryKey: ["providers"] })
            queryClient.invalidateQueries({ queryKey: ["models"] })
            setDeleteProvider(null)
        },
        onError: (e: Error) => toast.error(e.message || "Delete failed"),
    })

    const deleteModelMutation = useMutation({
        mutationFn: (id: string) => models.remove(id),
        onSuccess: () => {
            toast.success("Model deleted")
            queryClient.invalidateQueries({ queryKey: ["models"] })
            queryClient.invalidateQueries({ queryKey: ["providers"] })
            setDeleteModel(null)
        },
        onError: (e: Error) => toast.error(e.message || "Delete failed"),
    })

    return (
        <div className="h-full overflow-y-auto scrollbar-thin p-4 space-y-6">
            <h2 className="text-3xl font-bold tracking-tight">Providers & Models</h2>

            <Tabs defaultValue="providers" className="w-full" onValueChange={setActiveTab}>
                <div className="flex flex-col md:flex-row md:items-center justify-between pb-4 gap-4">
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
                        {isAdmin && activeTab === "providers" && (
                            <Button size="sm" onClick={() => setProviderDialog({ open: true, mode: "create" })}>
                                <Plus className="h-4 w-4 mr-1" /> Add Provider
                            </Button>
                        )}
                        {isAdmin && activeTab === "models" && (
                            <Button size="sm" onClick={() => setModelDialog({ open: true, mode: "create" })}>
                                <Plus className="h-4 w-4 mr-1" /> Add Model
                            </Button>
                        )}
                    </div>
                    <div className="flex flex-col md:flex-row gap-3 w-full md:w-auto md:items-center">
                        <div className="relative w-full md:w-64 md:order-2">
                            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Search..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-8 h-9"
                            />
                        </div>
                        <div className="flex items-center justify-between md:justify-end gap-2 md:order-1">
                            <div className="text-sm text-muted-foreground whitespace-nowrap">
                                {activeTab === "providers"
                                    ? `Showing ${filteredProviders.length} providers`
                                    : `Showing ${filteredModels.length} models`
                                }
                            </div>
                            <Select value={sortOrder} onValueChange={setSortOrder}>
                                <SelectTrigger className="w-auto min-w-[130px] h-9">
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
                        </div>
                    </div>
                </div>

                <TabsContent value="providers" className="mt-0">
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                        {isLoadingProviders ? (
                            <p className="text-muted-foreground">Loading providers...</p>
                        ) : filteredProviders.map((provider) => (
                            <ProviderCard
                                key={provider.id || provider.name}
                                provider={provider}
                                onClick={() => router.push(`/providers/${encodeURIComponent(provider.name)}`)}
                                hoverActions={isAdmin ? (
                                    <>
                                        <Button variant="secondary" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); setProviderDialog({ open: true, mode: "edit", provider }) }} title="Edit">
                                            <Pencil className="h-3.5 w-3.5" />
                                        </Button>
                                        <Button variant="secondary" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={(e) => { e.stopPropagation(); setDeleteProvider(provider) }} title="Delete">
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </Button>
                                    </>
                                ) : null}
                            />
                        ))}
                        {!isLoadingProviders && filteredProviders.length === 0 && (
                            <div className="col-span-full flex flex-col items-center justify-center border-2 border-dashed rounded-lg h-[calc(100vh-220px)] text-muted-foreground">
                                <Search className="h-8 w-8 mb-4 opacity-50" />
                                <p className="text-lg font-medium">No providers found.</p>
                                {isAdmin && (
                                    <Button size="sm" className="mt-4" onClick={() => setProviderDialog({ open: true, mode: "create" })}>
                                        <Plus className="h-4 w-4 mr-1" /> Add your first provider
                                    </Button>
                                )}
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
                                <ModelsTable
                                    models={filteredModels}
                                    onEdit={isAdmin ? (m) => {
                                        // Discovered rows have no DB row yet — opening the
                                        // dialog in "create" mode lets the admin save it as
                                        // an override, with all discovered defaults pre-filled.
                                        const mode = m.is_discovered ? "create" : "edit"
                                        setModelDialog({ open: true, mode, model: m })
                                    } : undefined}
                                    onDelete={isAdmin ? (m) => setDeleteModel(m) : undefined}
                                />
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>

            <ProviderFormDialog
                open={providerDialog.open}
                onOpenChange={(open) => setProviderDialog((s) => ({ ...s, open }))}
                mode={providerDialog.mode}
                provider={providerDialog.provider}
            />
            <ModelFormDialog
                open={modelDialog.open}
                onOpenChange={(open) => setModelDialog((s) => ({ ...s, open }))}
                mode={modelDialog.mode}
                model={modelDialog.model}
            />

            <AlertDialog open={!!deleteProvider} onOpenChange={(o) => !o && setDeleteProvider(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete provider?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will permanently delete <b>{deleteProvider?.name}</b> and all of its models. This cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => deleteProvider && deleteProviderMutation.mutate(deleteProvider.id)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <AlertDialog open={!!deleteModel} onOpenChange={(o) => !o && setDeleteModel(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete model?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will permanently delete model <b>{deleteModel?.name}</b>. This cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => deleteModel && deleteModelMutation.mutate(deleteModel.id)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}