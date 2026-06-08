"use client"

import * as React from "react"
import { Inbox } from "lucide-react"

import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"

/**
 * Shared visual contract for dashboard data tables (currently used by
 * /logs and /providers#models). Pages compose these primitives so the
 * "AIUI dashboard table" look — sticky muted header, uppercase head text,
 * zebra rows, hover highlight, consistent padding — lives in exactly one
 * place. Future style tweaks touch this file only.
 *
 * These primitives are visual-only by design (SRP). They do not know
 * about sorting, pagination, or data fetching; callers wire those.
 */

export function DataTableShell({
    className,
    ...props
}: React.ComponentProps<"table">) {
    return (
        <div className="overflow-hidden">
            <Table className={className} {...props} />
        </div>
    )
}

export function DataTableHeader({
    className,
    ...props
}: React.ComponentProps<"thead">) {
    return (
        <TableHeader
            className={cn("bg-muted/40 sticky top-0 z-10", className)}
            {...props}
        />
    )
}

export function DataTableHeaderRow({
    className,
    ...props
}: React.ComponentProps<"tr">) {
    return (
        <TableRow
            className={cn(
                "hover:bg-transparent border-b-muted/60 shadow-sm",
                className,
            )}
            {...props}
        />
    )
}

export function DataTableHead({
    className,
    ...props
}: React.ComponentProps<"th">) {
    return (
        <TableHead
            className={cn(
                "h-10 text-xs font-semibold uppercase tracking-wide text-muted-foreground/80 first:pl-4 last:pr-4",
                className,
            )}
            {...props}
        />
    )
}

export function DataTableRow({
    className,
    interactive = true,
    ...props
}: React.ComponentProps<"tr"> & { interactive?: boolean }) {
    return (
        <TableRow
            className={cn(
                "h-10 border-b-muted/20 even:bg-muted/50 group",
                interactive && "cursor-pointer hover:bg-muted/90",
                className,
            )}
            {...props}
        />
    )
}

export function DataTableCell({
    className,
    ...props
}: React.ComponentProps<"td">) {
    return (
        <TableCell
            className={cn("py-2 first:pl-4 last:pr-4", className)}
            {...props}
        />
    )
}

export function DataTableEmpty({
    colSpan,
    children: _children,
}: {
    colSpan: number
    children?: React.ReactNode
}) {
    void _children
    return (
        <TableRow className="hover:bg-transparent">
            <TableCell
                colSpan={colSpan}
                className="h-48 text-center align-middle text-muted-foreground/40"
            >
                <div className="flex items-center justify-center">
                    <Inbox className="h-8 w-8" aria-label="empty" />
                </div>
            </TableCell>
        </TableRow>
    )
}

export { TableBody as DataTableBody }
