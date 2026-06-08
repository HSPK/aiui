"use client"

import * as React from "react"
import { CheckCircle2, Loader2, Pencil, Trash2, XCircle } from "lucide-react"

import type { McpServerDTO } from "@/lib/schemas/mcp"
import { Badge } from "@/components/ui/badge"
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
            <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {count} tool{count === 1 ? "" : "s"}
            </span>
        )
    }
    if (s.last_check_status === "error") {
        return (
            <span
                className="inline-flex items-center gap-1 text-[11px] text-destructive"
                title={s.last_check_error ?? undefined}
            >
                <XCircle className="h-3.5 w-3.5" />
                Failed
            </span>
        )
    }
    return (
        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Checking…
        </span>
    )
}

export function McpServersTable({ servers, onSelect, onEdit, onDelete, selectedId }: Props) {
    const showActions = !!onEdit || !!onDelete
    const colCount = showActions ? 6 : 5

    return (
        <DataTableShell>
            <DataTableHeader>
                <DataTableHeaderRow>
                    <DataTableHead>Name</DataTableHead>
                    <DataTableHead>Transport</DataTableHead>
                    <DataTableHead>Endpoint / Command</DataTableHead>
                    <DataTableHead>Health</DataTableHead>
                    <DataTableHead>Enabled</DataTableHead>
                    {showActions && <DataTableHead className="w-[88px] text-right">Actions</DataTableHead>}
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
                                onSelect && "cursor-pointer hover:bg-muted/40",
                                selectedId === s.id && "bg-muted/60",
                            )}
                            onClick={onSelect ? () => onSelect(s) : undefined}
                        >
                            <DataTableCell className="font-mono text-xs max-w-[200px] truncate" title={s.name}>
                                {s.name}
                            </DataTableCell>
                            <DataTableCell>
                                <Badge variant="outline" className="text-[10px] uppercase">
                                    {s.transport}
                                </Badge>
                            </DataTableCell>
                            <DataTableCell className="font-mono text-xs text-muted-foreground max-w-[360px] truncate" title={summarizeConfig(s)}>
                                {summarizeConfig(s) || <span className="italic">—</span>}
                            </DataTableCell>
                            <DataTableCell>
                                <HealthCell s={s} />
                            </DataTableCell>
                            <DataTableCell>
                                <Badge variant={s.enabled ? "default" : "secondary"} className="text-[10px] uppercase">
                                    {s.enabled ? "on" : "off"}
                                </Badge>
                            </DataTableCell>
                            {showActions && (
                                <DataTableCell className="text-right">
                                    <div className="flex items-center justify-end gap-1">
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
                                                className="h-7 w-7 text-destructive hover:text-destructive"
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
