"use client"

import * as React from "react"
import { Pencil, Trash2 } from "lucide-react"

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

interface Props {
    servers: McpServerDTO[]
    onEdit?: (s: McpServerDTO) => void
    onDelete?: (s: McpServerDTO) => void
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

export function McpServersTable({ servers, onEdit, onDelete }: Props) {
    const showActions = !!onEdit || !!onDelete
    const colCount = showActions ? 5 : 4

    return (
        <DataTableShell>
            <DataTableHeader>
                <DataTableHeaderRow>
                    <DataTableHead>Name</DataTableHead>
                    <DataTableHead>Transport</DataTableHead>
                    <DataTableHead>Endpoint / Command</DataTableHead>
                    <DataTableHead>Status</DataTableHead>
                    {showActions && <DataTableHead className="w-[88px] text-right">Actions</DataTableHead>}
                </DataTableHeaderRow>
            </DataTableHeader>
            <DataTableBody>
                {servers.length === 0 ? (
                    <DataTableEmpty colSpan={colCount}>No MCP servers registered yet.</DataTableEmpty>
                ) : (
                    servers.map((s) => (
                        <DataTableRow key={s.id}>
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
                                <Badge variant={s.enabled ? "default" : "secondary"} className="text-[10px] uppercase">
                                    {s.enabled ? "on" : "off"}
                                </Badge>
                            </DataTableCell>
                            {showActions && (
                                <DataTableCell className="text-right">
                                    <div className="flex items-center justify-end gap-1">
                                        {onEdit && (
                                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEdit(s)} title="Edit">
                                                <Pencil className="h-3.5 w-3.5" />
                                            </Button>
                                        )}
                                        {onDelete && (
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-7 w-7 text-destructive hover:text-destructive"
                                                onClick={() => onDelete(s)}
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
