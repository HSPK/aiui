"use client"

import * as React from "react"
import { Pencil, Trash2 } from "lucide-react"

import type { ToolDTO } from "@/lib/schemas/tool"
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

interface Props {
    tools: ToolDTO[]
    onEdit?: (t: ToolDTO) => void
    onDelete?: (t: ToolDTO) => void
}

export function ToolsTable({ tools, onEdit, onDelete }: Props) {
    const showActions = !!onEdit || !!onDelete
    const colCount = showActions ? 5 : 4

    return (
        <DataTableShell>
            <DataTableHeader>
                <DataTableHeaderRow>
                    <DataTableHead>Name</DataTableHead>
                    <DataTableHead>Description</DataTableHead>
                    <DataTableHead>Webhook</DataTableHead>
                    <DataTableHead>Status</DataTableHead>
                    {showActions && <DataTableHead className="w-[88px] text-right">Actions</DataTableHead>}
                </DataTableHeaderRow>
            </DataTableHeader>
            <DataTableBody>
                {tools.length === 0 ? (
                    <DataTableEmpty colSpan={colCount}>No tools registered yet.</DataTableEmpty>
                ) : (
                    tools.map((t) => (
                        <DataTableRow key={t.id}>
                            <DataTableCell className="font-mono text-xs max-w-[200px] truncate" title={t.name}>
                                {t.name}
                            </DataTableCell>
                            <DataTableCell className="text-xs text-muted-foreground max-w-[320px] truncate" title={t.description}>
                                {t.description || "—"}
                            </DataTableCell>
                            <DataTableCell className="text-xs font-mono text-muted-foreground max-w-[260px] truncate" title={t.webhook_url ?? undefined}>
                                {t.webhook_url ?? <span className="italic">none</span>}
                            </DataTableCell>
                            <DataTableCell>
                                <Badge variant={t.enabled ? "default" : "secondary"} className="text-[10px] uppercase">
                                    {t.enabled ? "on" : "off"}
                                </Badge>
                            </DataTableCell>
                            {showActions && (
                                <DataTableCell className="text-right">
                                    <div className="flex items-center justify-end gap-1">
                                        {onEdit && (
                                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEdit(t)} title="Edit">
                                                <Pencil className="h-3.5 w-3.5" />
                                            </Button>
                                        )}
                                        {onDelete && (
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-7 w-7 text-destructive hover:text-destructive"
                                                onClick={() => onDelete(t)}
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
