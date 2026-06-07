"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Copy, MoreHorizontal, Pencil, Trash2 } from "lucide-react"

import type { ModelDTO } from "@/lib/schemas/model"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip"

import { capabilityLabel } from "./capability-label"

interface Props {
    models: ModelDTO[]
    /** Admin: opens edit dialog (or "register override" for discovered rows). */
    onEdit?: (model: ModelDTO) => void
    /** Admin: opens delete confirmation. */
    onDelete?: (model: ModelDTO) => void
}

/** Table of models. Row click navigates to the per-model dashboard;
 *  admin Edit / Delete live in the row dropdown so a stray click never
 *  triggers them. Built on the shared DataTable primitives so it inherits
 *  the same look as /logs (sticky muted header, uppercase head text,
 *  zebra rows, hover highlight). */
export function ModelsTable({ models, onEdit, onDelete }: Props) {
    const router = useRouter()
    const showActions = !!onEdit || !!onDelete
    const columnCount = showActions ? 7 : 6

    return (
        <DataTableShell>
            <DataTableHeader>
                <DataTableHeaderRow>
                    <DataTableHead>Model Name</DataTableHead>
                    <DataTableHead>ID</DataTableHead>
                    <DataTableHead>Provider</DataTableHead>
                    <DataTableHead>Type</DataTableHead>
                    <DataTableHead>Context</DataTableHead>
                    <DataTableHead>Source</DataTableHead>
                    {showActions && <DataTableHead className="w-[40px]" />}
                </DataTableHeaderRow>
            </DataTableHeader>
            <DataTableBody>
                {models.length === 0 ? (
                    <DataTableEmpty colSpan={columnCount}>No models found.</DataTableEmpty>
                ) : (
                    models.map((model) => (
                        <DataTableRow
                            key={model.id || model.name}
                            onClick={() =>
                                router.push(`/models/${encodeURIComponent(model.name)}`)
                            }
                            title="Open model dashboard"
                        >
                            <DataTableCell className="font-mono max-w-[300px]">
                                <div className="flex items-center justify-between gap-2 w-full">
                                    <span className="truncate text-xs" title={model.name}>
                                        {model.name}
                                    </span>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            navigator.clipboard.writeText(model.name)
                                            toast.success("Model name copied to clipboard")
                                        }}
                                    >
                                        <Copy className="h-3 w-3 text-muted-foreground" />
                                    </Button>
                                </div>
                            </DataTableCell>
                            <DataTableCell className="font-mono text-xs text-muted-foreground max-w-[260px]">
                                <TooltipProvider>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <span className="truncate block cursor-default">
                                                {model.model_id}
                                            </span>
                                        </TooltipTrigger>
                                        <TooltipContent side="top">
                                            <p className="font-mono text-xs">{model.model_id}</p>
                                        </TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                            </DataTableCell>
                            <DataTableCell>
                                <Badge variant="outline" className="font-normal text-[10px]">
                                    {model.provider}
                                </Badge>
                            </DataTableCell>
                            <DataTableCell>
                                <Badge variant="secondary" className="font-normal text-[10px]">
                                    {capabilityLabel(model.type)}
                                </Badge>
                            </DataTableCell>
                            <DataTableCell>
                                <span className="font-mono text-xs text-muted-foreground">
                                    {model.context_window
                                        ? model.context_window >= 1000
                                            ? `${Math.round(model.context_window / 1000)}k`
                                            : model.context_window.toLocaleString()
                                        : "—"}
                                </span>
                            </DataTableCell>
                            <DataTableCell>
                                <Badge
                                    variant={model.is_discovered ? "secondary" : "default"}
                                    className="text-[10px] uppercase"
                                >
                                    {model.is_discovered ? "discovered" : "override"}
                                </Badge>
                            </DataTableCell>
                            {showActions && (
                                <DataTableCell
                                    className="w-[40px] text-right"
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    <RowActions
                                        model={model}
                                        onEdit={onEdit}
                                        onDelete={onDelete}
                                    />
                                </DataTableCell>
                            )}
                        </DataTableRow>
                    ))
                )}
            </DataTableBody>
        </DataTableShell>
    )
}

function RowActions({
    model,
    onEdit,
    onDelete,
}: {
    model: ModelDTO
    onEdit?: (model: ModelDTO) => void
    onDelete?: (model: ModelDTO) => void
}) {
    const canDelete = !!onDelete && !model.is_discovered
    if (!onEdit && !canDelete) return null

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={(e) => e.stopPropagation()}
                >
                    <MoreHorizontal className="h-4 w-4" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
                {onEdit && (
                    <DropdownMenuItem onSelect={() => onEdit(model)}>
                        <Pencil className="mr-2 h-3.5 w-3.5" />
                        Edit
                    </DropdownMenuItem>
                )}
                {onEdit && canDelete && <DropdownMenuSeparator />}
                {canDelete && (
                    <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onSelect={() => onDelete?.(model)}
                    >
                        <Trash2 className="mr-2 h-3.5 w-3.5" />
                        Delete
                    </DropdownMenuItem>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
