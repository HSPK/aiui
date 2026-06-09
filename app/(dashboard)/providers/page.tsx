"use client"

import * as React from "react"
import { models } from "@/lib/api/models";
import { providers } from "@/lib/api/providers";
import type { ProviderDTO } from "@/lib/schemas/provider";
import type { ModelDTO } from "@/lib/schemas/model";

import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { toast } from "sonner"
import { Search, ArrowUpDown, Plus, Pencil, Trash2 } from "lucide-react"
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
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { LoadingState } from "@/components/ui/loading-state"
import { RefreshButton } from "@/components/ui/refresh-button"
import { ProviderCard } from "@/components/providers/provider-card"
import { ModelsTable } from "@/components/providers/models-table"
import { ProviderFormDialog } from "@/components/providers/provider-form-dialog"
import { ModelFormDialog } from "@/components/providers/model-form-dialog"
import { useAuth } from "@/context/auth-context"

export default function ProvidersPage() {
    const router = useRouter()
    const { user } = useAuth()
    const isAdmin = user?.role === "admin"
    const [searchQuery, setSearchQuery] = useState("")
    const [activeTab, setActiveTab] = useState("providers")
    const [sortOrder, setSortOrder] = useState("default")

    const [providerDialog, setProviderDialog] = useState<{ open: boolean; mode: "create" | "edit"; provider?: ProviderDTO | null }>({ open: false, mode: "create" })
    const [modelDialog, setModelDialog] = useState<{ open: boolean; mode: "create" | "edit"; model?: ModelDTO | null }>({ open: false, mode: "create" })
    const [deleteProvider, setDeleteProvider] = useState<ProviderDTO | null>(null)
    const [deleteModel, setDeleteModel] = useState<ModelDTO | null>(null)

    const { data: providerList, isLoading: isLoadingProviders } = providers.useList()
    const { data: modelList, isLoading: isLoadingModels } = models.useList(undefined, {
        enabled: activeTab === "models",
    })

    // Sorting + filtering memoised so typing in the search box doesn't
    // re-walk the list per keystroke. Cheap for small N but worth
    // doing right — the same component handles 1k+ provider deployments.
    const filteredProviders = React.useMemo(() => {
        if (!providerList) return []
        const q = searchQuery.toLowerCase()
        const filtered = providerList.filter((p) =>
            p.provider_name.toLowerCase().includes(q) ||
            (p.proxy || "").toLowerCase().includes(q)
        )
        if (sortOrder === "name") {
            filtered.sort((a, b) => a.provider_name.localeCompare(b.provider_name))
        } else if (sortOrder === "models") {
            filtered.sort((a, b) => (b.n_models || 0) - (a.n_models || 0))
        }
        return filtered
    }, [providerList, searchQuery, sortOrder])

    const filteredModels = React.useMemo(() => {
        if (!modelList) return []
        const q = searchQuery.toLowerCase()
        const filtered = modelList.filter((m) =>
            m.name.toLowerCase().includes(q) ||
            (m.model_id || "").toLowerCase().includes(q) ||
            (m.provider || "").toLowerCase().includes(q)
        )
        if (sortOrder === "name") {
            filtered.sort((a, b) => a.name.localeCompare(b.name))
        } else if (sortOrder === "type") {
            filtered.sort((a, b) => a.type.localeCompare(b.type))
        } else if (sortOrder === "provider") {
            filtered.sort((a, b) => (a.provider || "").localeCompare(b.provider || ""))
        } else if (sortOrder === "context") {
            filtered.sort((a, b) => (b.context_window || 0) - (a.context_window || 0))
        }
        return filtered
    }, [modelList, searchQuery, sortOrder])

    // providers' `invalidates: ["models"]` in the resource descriptor cascades
    // these mutations to the models cache automatically.
    const reloadMutation = providers.useReload({
        onSuccess: () => toast.success("Refreshed"),
        onError: (error) => toast.error(`Refresh failed: ${error.message}`),
    })

    const deleteProviderMutation = providers.useDelete({
        onSuccess: () => {
            toast.success("Provider deleted")
            setDeleteProvider(null)
        },
        onError: (e) => toast.error(e.message || "Delete failed"),
    })

    const deleteModelMutation = models.useDelete({
        onSuccess: () => {
            toast.success("Model deleted")
            setDeleteModel(null)
        },
        onError: (e) => toast.error(e.message || "Delete failed"),
    })

    return (
        <div className="h-full flex flex-col p-4 overflow-y-hidden">
            <Tabs
                defaultValue="providers"
                className="flex-1 flex flex-col min-h-0 w-full gap-4"
                onValueChange={setActiveTab}
            >
                {/* Toolbar — mirrors the design pattern used on /logs:
                    compact single row, h-8 controls, text-xs, mid-row dividers,
                    refresh button isolated on the trailing edge. */}
                <div className="flex items-center gap-2 px-1 flex-wrap md:flex-nowrap">
                    <TabsList className="h-8 p-0.5">
                        <TabsTrigger value="providers" className="h-7 px-3 text-xs">
                            Providers
                        </TabsTrigger>
                        <TabsTrigger value="models" className="h-7 px-3 text-xs">
                            Models
                        </TabsTrigger>
                    </TabsList>

                    <div className="h-4 w-px bg-border mx-1 hidden md:block shrink-0" />

                    <div className="relative w-[160px] md:w-[220px] shrink-0">
                        <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
                        <Input
                            placeholder="Search..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-7 h-8 text-xs"
                        />
                    </div>

                    <Select value={sortOrder} onValueChange={setSortOrder}>
                        <SelectTrigger className="w-[140px] h-8 text-xs shrink-0">
                            <ArrowUpDown className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" />
                            <SelectValue placeholder="Sort" />
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

                    {isAdmin && activeTab === "providers" && (
                        <Button
                            size="icon"
                            variant="secondary"
                            className="h-8 w-8 shrink-0"
                            onClick={() => setProviderDialog({ open: true, mode: "create" })}
                            title="Add provider"
                            aria-label="Add provider"
                        >
                            <Plus className="h-3.5 w-3.5" />
                        </Button>
                    )}
                    {isAdmin && activeTab === "models" && (
                        <Button
                            size="icon"
                            variant="secondary"
                            className="h-8 w-8 shrink-0"
                            onClick={() => setModelDialog({ open: true, mode: "create" })}
                            title="Add model"
                            aria-label="Add model"
                        >
                            <Plus className="h-3.5 w-3.5" />
                        </Button>
                    )}

                    <div className="ml-auto flex items-center gap-2 shrink-0">
                        <span className="text-xs text-muted-foreground tabular-nums hidden sm:inline">
                            {activeTab === "providers"
                                ? `${filteredProviders.length} providers`
                                : `${filteredModels.length} models`}
                        </span>
                        <div className="shrink-0 pl-2 border-l border-border/50">
                            <RefreshButton
                                onClick={() => reloadMutation.mutate()}
                                isLoading={reloadMutation.isPending}
                                tooltip="Reload providers and models"
                            />
                        </div>
                    </div>
                </div>

                <TabsContent
                    value="providers"
                    className="flex-1 min-h-0 overflow-y-auto scrollbar-thin"
                >
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 p-1">
                        {isLoadingProviders ? (
                            <div className="col-span-full">
                                <LoadingState label="Loading providers…" />
                            </div>
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
                            <div className="col-span-full flex flex-col items-center justify-center border-2 border-dashed rounded-lg min-h-[300px] text-muted-foreground">
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

                <TabsContent
                    value="models"
                    className="flex-1 min-h-0 flex flex-col"
                >
                    <div className="flex-1 border rounded-xl bg-card shadow-sm flex flex-col overflow-hidden relative">
                        {isLoadingModels && (
                            <div className="absolute inset-0 flex items-center justify-center bg-background/50 z-10">
                                <LoadingState label="Loading models…" />
                            </div>
                        )}
                        <div className="flex-1 overflow-auto">
                            <ModelsTable
                                models={filteredModels}
                                onEdit={isAdmin ? (m) => {
                                    // Discovered rows have no DB row yet — opening the
                                    // popup in "create" mode promotes them into a
                                    // DB-backed override with the discovered defaults
                                    // pre-filled.
                                    const mode = m.is_discovered ? "create" : "edit"
                                    setModelDialog({ open: true, mode, model: m })
                                } : undefined}
                                onDelete={isAdmin ? (m) => setDeleteModel(m) : undefined}
                            />
                        </div>
                    </div>
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

            <ConfirmDialog
                open={!!deleteProvider}
                onOpenChange={(o) => !o && setDeleteProvider(null)}
                title="Delete provider?"
                description={<>This will permanently delete <b>{deleteProvider?.name}</b> and all of its models. This cannot be undone.</>}
                confirmLabel="Delete"
                destructive
                isLoading={deleteProviderMutation.isPending}
                onConfirm={() => deleteProvider && deleteProviderMutation.mutate(deleteProvider.id)}
            />
            <ConfirmDialog
                open={!!deleteModel}
                onOpenChange={(o) => !o && setDeleteModel(null)}
                title="Delete model?"
                description={<>This will permanently delete model <b>{deleteModel?.name}</b>. This cannot be undone.</>}
                confirmLabel="Delete"
                destructive
                isLoading={deleteModelMutation.isPending}
                onConfirm={() => deleteModel && deleteModelMutation.mutate(deleteModel.id)}
            />
        </div>
    )
}