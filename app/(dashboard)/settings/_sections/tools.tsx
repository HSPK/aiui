"use client"

import * as React from "react"
import { Plus, Wrench } from "lucide-react"
import { toast } from "sonner"

import { tools } from "@/lib/api"
import type { ToolDTO } from "@/lib/schemas/tool"

import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { ToolFormDialog } from "@/components/tools/tool-form-dialog"
import { ToolsTable } from "@/components/tools/tools-table"

import { SettingsSection } from "./shared"

type ToolDialogState = { open: boolean; mode: "create" | "edit"; tool?: ToolDTO | null }

/** Hand-written JSON Schema function tools. Settings-only because MCP
 *  is the headline path; this is an escape hatch for one-off webhook-
 *  backed tools that don't justify spinning up an MCP server. */
export function ToolsSection() {
    const { data: list } = tools.useList()
    const [dialog, setDialog] = React.useState<ToolDialogState>({ open: false, mode: "create" })
    const [deleting, setDeleting] = React.useState<ToolDTO | null>(null)

    const deleteMutation = tools.useDelete({
        onSuccess: () => {
            toast.success("Tool deleted")
            setDeleting(null)
        },
        onError: (e) => toast.error(e.message || "Delete failed"),
    })

    const items = list ?? []

    return (
        <SettingsSection
            icon={Wrench}
            title="Custom tools"
            action={
                <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setDialog({ open: true, mode: "create" })}
                >
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    Add tool
                </Button>
            }
        >
            <div className="border rounded-lg overflow-hidden">
                <ToolsTable
                    tools={items}
                    onEdit={(t) => setDialog({ open: true, mode: "edit", tool: t })}
                    onDelete={setDeleting}
                />
            </div>

            <ToolFormDialog
                open={dialog.open}
                onOpenChange={(open) => setDialog((s) => ({ ...s, open }))}
                mode={dialog.mode}
                tool={dialog.tool}
            />

            <ConfirmDialog
                open={!!deleting}
                onOpenChange={(o) => !o && setDeleting(null)}
                title="Delete tool?"
                description={<>This will delete <b>{deleting?.name}</b>.</>}
                confirmLabel="Delete"
                destructive
                isLoading={deleteMutation.isPending}
                onConfirm={() => deleting && deleteMutation.mutate(deleting.id)}
            />
        </SettingsSection>
    )
}
