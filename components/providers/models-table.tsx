"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Copy, Pencil, Trash2 } from "lucide-react"

import type { ModelDTO } from "@/lib/schemas/model"
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
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip"

import { capabilityLabel } from "./capability-label"

interface Props {
    models: ModelDTO[]
    /** Admin: per-row Delete handler. Edit is always a direct link (no
     *  callback) so it can be middle-clicked / opened in a new tab. */
    onDelete?: (model: ModelDTO) => void
    /** When set, edit links carry `?from=<href>` so cancel returns here.
     *  Defaults to the current pathname. */
    backHref?: string
}

/** Table of models. Row click navigates to the per-model dashboard.
 *  Per-row Edit is a direct link to /models/<name>/edit (1 click, no
 *  popups, opens-in-new-tab works). Delete sits beside it and triggers
 *  the parent's confirm dialog. */
export function ModelsTable({ models, onDelete, backHref }: Props) {
    const router = useRouter()
    const showActions = !!onDelete
    const columnCount = showActions ? 7 : 6
    const fromParam = backHref ? `?from=${encodeURIComponent(backHref)}` : ""

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
                    {showActions && <DataTableHead className="w-[88px] text-right">Actions</DataTableHead>}
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
                                    className="text-right"
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    <div className="flex items-center justify-end gap-1">
                                        <Button
                                            asChild
                                            variant="ghost"
                                            size="icon"
                                            className="h-7 w-7"
                                            title={model.is_discovered ? "Promote to override" : "Edit"}
                                        >
                                            <Link
                                                href={`/models/${encodeURIComponent(model.name)}/edit${fromParam}`}
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                <Pencil className="h-3.5 w-3.5" />
                                            </Link>
                                        </Button>
                                        {!model.is_discovered && (
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-7 w-7 text-destructive hover:text-destructive"
                                                title="Delete"
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    onDelete?.(model)
                                                }}
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

