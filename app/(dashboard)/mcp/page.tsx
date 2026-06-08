"use client"

import * as React from "react"
import { Plus, Sparkles } from "lucide-react"
import { toast } from "sonner"

import { mcpServers } from "@/lib/api"
import { useAuth } from "@/context/auth-context"
import type { McpServerDTO } from "@/lib/schemas/mcp"

import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { LoadingState } from "@/components/ui/loading-state"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { McpFormDialog } from "@/components/tools/mcp-form-dialog"
import { McpServersTable } from "@/components/tools/mcp-table"
import { McpServerDetailsSheet } from "@/components/tools/mcp-details-sheet"

type McpDialogState = { open: boolean; mode: "create" | "edit"; server?: McpServerDTO | null }

/** Primary MCP / Skills page. Hand-written tool definitions live in
 *  /settings as a less-prominent escape hatch — MCP is the headline. */
export default function McpPage() {
    const { user } = useAuth()
    const isAdmin = user?.role === "admin"
    const [activeTab, setActiveTab] = React.useState("mcp")

    const { data: mcpList, isLoading: loadingMcp } = mcpServers.useList(undefined, {
        enabled: activeTab === "mcp",
        // Auto-refresh while any server is still "checking" (status
        // null) so the post-create background probe surfaces without
        // a manual refresh.
        refetchInterval: (q) => {
            const data = q.state.data as McpServerDTO[] | undefined
            if (!data) return false
            return data.some((s) => s.last_check_status === null) ? 2_000 : false
        },
    })

    const [mcpDialog, setMcpDialog] = React.useState<McpDialogState>({ open: false, mode: "create" })
    const [deleteServer, setDeleteServer] = React.useState<McpServerDTO | null>(null)
    const [selectedId, setSelectedId] = React.useState<string | null>(null)

    const selectedServer = React.useMemo(
        () => (mcpList ?? []).find((s) => s.id === selectedId) ?? null,
        [mcpList, selectedId],
    )

    const deleteServerMutation = mcpServers.useDelete({
        onSuccess: () => {
            toast.success("Server deleted")
            setDeleteServer(null)
            if (selectedId === deleteServer?.id) setSelectedId(null)
        },
        onError: (e) => toast.error(e.message || "Delete failed"),
    })

    return (
        <div className="h-full flex flex-col p-4 overflow-y-hidden">
            <Tabs
                defaultValue="mcp"
                className="flex-1 flex flex-col min-h-0 w-full gap-4"
                onValueChange={setActiveTab}
            >
                <div className="flex items-center gap-2 px-1 flex-wrap md:flex-nowrap">
                    <TabsList className="h-8 p-0.5">
                        <TabsTrigger value="mcp" className="h-7 px-3 text-xs">MCP</TabsTrigger>
                        <TabsTrigger value="skills" className="h-7 px-3 text-xs">Skills</TabsTrigger>
                    </TabsList>

                    {isAdmin && activeTab === "mcp" && (
                        <Button
                            size="icon"
                            variant="secondary"
                            className="h-8 w-8 shrink-0 ml-auto"
                            onClick={() => setMcpDialog({ open: true, mode: "create" })}
                            title="Add MCP server"
                        >
                            <Plus className="h-3.5 w-3.5" />
                        </Button>
                    )}
                </div>

                <TabsContent value="mcp" className="flex-1 min-h-0 flex flex-col">
                    <div className="flex-1 border rounded-xl bg-card shadow-sm flex flex-col overflow-hidden relative">
                        {loadingMcp && (
                            <div className="absolute inset-0 flex items-center justify-center bg-background/50 z-10">
                                <LoadingState label="Loading MCP servers…" />
                            </div>
                        )}
                        <div className="flex-1 overflow-auto">
                            <McpServersTable
                                servers={mcpList ?? []}
                                onSelect={(s) => setSelectedId(s.id)}
                                onEdit={isAdmin ? (s) => setMcpDialog({ open: true, mode: "edit", server: s }) : undefined}
                                onDelete={isAdmin ? setDeleteServer : undefined}
                                selectedId={selectedId}
                            />
                        </div>
                    </div>
                </TabsContent>

                <TabsContent value="skills" className="flex-1 min-h-0 flex flex-col items-center justify-center text-center">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500/20 to-orange-500/20">
                        <Sparkles className="h-6 w-6 text-amber-500" />
                    </div>
                    <h2 className="mt-3 text-base font-semibold tracking-tight">Skills</h2>
                    <p className="mt-1 text-xs text-muted-foreground">Coming soon.</p>
                </TabsContent>
            </Tabs>

            <McpFormDialog
                open={mcpDialog.open}
                onOpenChange={(open) => setMcpDialog((s) => ({ ...s, open }))}
                mode={mcpDialog.mode}
                server={mcpDialog.server}
            />

            <McpServerDetailsSheet
                server={selectedServer}
                open={!!selectedServer}
                onOpenChange={(o) => !o && setSelectedId(null)}
                isAdmin={isAdmin}
            />

            <ConfirmDialog
                open={!!deleteServer}
                onOpenChange={(o) => !o && setDeleteServer(null)}
                title="Delete MCP server?"
                description={<>This will delete <b>{deleteServer?.name}</b>.</>}
                confirmLabel="Delete"
                destructive
                isLoading={deleteServerMutation.isPending}
                onConfirm={() => deleteServer && deleteServerMutation.mutate(deleteServer.id)}
            />
        </div>
    )
}
