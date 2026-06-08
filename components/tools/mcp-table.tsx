"use client"

import * as React from "react"
import { CheckCircle2, Loader2, Pencil, RefreshCcw, Trash2, XCircle } from "lucide-react"
import { toast } from "sonner"

import { mcpServers } from "@/lib/api"
import type { McpServerDTO } from "@/lib/schemas/mcp"
import { Button } from "@/components/ui/button"
import {
    DataTableBody,
    DataTableCell,
    DataTableEmpty,
    DataTableHead,
    DataTableHeader,
    DataTableHeaderRow,
    DataTableRow,
    DataTableShell,
} from "@/components/ui/data-table"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"

interface Props {
    servers: McpServerDTO[]
    onSelect?: (s: McpServerDTO) => void
    onEdit?: (s: McpServerDTO) => void
    onDelete?: (s: McpServerDTO) => void
    /** When set, the row matching this id renders with an accent
     *  background — mirrors the providers/models table selection. */
    selectedId?: string | null
}

function summarizeConfig(s: McpServerDTO): string {
    const c = s.config ?? {}
    if (s.transport === "stdio") {
        const command = typeof c.command === "string" ? c.command : ""
        const args = Array.isArray(c.args) ? (c.args as string[]).join(" ") : ""
        return `${command} ${args}`.trim()
    }
    return typeof c.url === "string" ? c.url : ""
}

function HealthCell({ s }: { s: McpServerDTO }) {
    if (s.last_check_status === "ok") {
        const count = s.tools_cache?.length ?? 0
        return (
            <span className="inline-flex items-center gap-1.5 text-[11px] text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {count} tool{count === 1 ? "" : "s"}
            </span>
        )
    }
    if (s.last_check_status === "error") {
        return (
            <span
                className="inline-flex items-center gap-1.5 text-[11px] text-destructive"
                title={s.last_check_error ?? undefined}
            >
                <XCircle className="h-3.5 w-3.5" />
                Failed
            </span>
        )
    }
    return (
        <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Checking…
        </span>
    )
}

export function McpServersTable({ servers, onSelect, onEdit, onDelete, selectedId }: Props) {
    const showActions = !!onEdit || !!onDelete
    const colCount = showActions ? 6 : 5
    // Mutations are read once at the table level so a single in-flight
    // toggle / re-check doesn't blow away unrelated rows' cache.
    const update = mcpServers.useUpdate({
        onError: (e: Error) => toast.error(e.message || "Update failed"),
    })
    const check = mcpServers.useCheck({
        onSuccess: (s) => {
            if (s.last_check_status === "ok") {
                toast.success(`${s.name}: ${s.tools_cache?.length ?? 0} tools`)
            } else {
                toast.error(`${s.name}: ${s.last_check_error ?? "check failed"}`)
            }
        },
        onError: (e) => toast.error(e.message || "Check failed"),
    })

    return (
        <DataTableShell>
            <DataTableHeader>
                <DataTableHeaderRow>
                    <DataTableHead>Name</DataTableHead>
                    <DataTableHead>Transport</DataTableHead>
                    <DataTableHead>Endpoint / Command</DataTableHead>
                    <DataTableHead>Health</DataTableHead>
                    <DataTableHead className="w-[80px] text-center">Enabled</DataTableHead>
                    {showActions && <DataTableHead className="w-[124px] text-right">Actions</DataTableHead>}
                </DataTableHeaderRow>
            </DataTableHeader>
            <DataTableBody>
                {servers.length === 0 ? (
                    <DataTableEmpty colSpan={colCount} />
                ) : (
                    servers.map((s) => (
                        <DataTableRow
                            key={s.id}
                            className={cn(
                                "transition-colors",
                                onSelect && "cursor-pointer hover:bg-muted/40",
                                selectedId === s.id && "bg-muted/60",
                                !s.enabled && "opacity-60",
                            )}
                            onClick={onSelect ? () => onSelect(s) : undefined}
                        >
                            <DataTableCell className="font-mono text-xs max-w-[200px] truncate" title={s.name}>
                                {s.name}
                            </DataTableCell>
                            <DataTableCell>
                                <span className="inline-flex items-center rounded border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                                    {s.transport}
                                </span>
                            </DataTableCell>
                            <DataTableCell className="font-mono text-xs text-muted-foreground max-w-[360px] truncate" title={summarizeConfig(s)}>
                                {summarizeConfig(s) || <span className="italic">—</span>}
                            </DataTableCell>
                            <DataTableCell>
                                <HealthCell s={s} />
                            </DataTableCell>
                            <DataTableCell className="text-center">
                                <Switch
                                    checked={s.enabled}
                                    disabled={!onEdit || update.isPending}
                                    onCheckedChange={(checked) => {
                                        update.mutate({ id: s.id, data: { enabled: checked } })
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                    title={s.enabled ? "Disable" : "Enable"}
                                />
                            </DataTableCell>
                            {showActions && (
                                <DataTableCell className="text-right">
                                    <div className="flex items-center justify-end gap-0.5">
                                        {onEdit && (
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-7 w-7"
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    check.mutate(s.id)
                                                }}
                                                disabled={check.isPending && check.variables === s.id}
                                                title="Re-check connection"
                                            >
                                                <RefreshCcw className={cn(
                                                    "h-3.5 w-3.5",
                                                    check.isPending && check.variables === s.id && "animate-spin",
                                                )} />
                                            </Button>
                                        )}
                                        {onEdit && (
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-7 w-7"
                                                onClick={(e) => { e.stopPropagation(); onEdit(s) }}
                                                title="Edit"
                                            >
                                                <Pencil className="h-3.5 w-3.5" />
                                            </Button>
                                        )}
                                        {onDelete && (
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                                onClick={(e) => { e.stopPropagation(); onDelete(s) }}
                                                title="Delete"
                                            >
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </Button>
                                        )}
                                    </div>
                                </DataTableCell>
                            )}
                        </DataTableRow>
                    ))
                )}
            </DataTableBody>
        </DataTableShell>
    )
}
