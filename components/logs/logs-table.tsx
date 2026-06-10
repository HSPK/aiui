"use client"

import type { LogListItemDTO } from "@/lib/schemas/log";
import { capabilityLabel } from "@/components/providers/capability-label"
import {
    ColumnDef,
    flexRender,
    getCoreRowModel,
    useReactTable,
    SortingState,
    OnChangeFn,
} from "@tanstack/react-table"

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
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ArrowUpDown, Files, Zap, Clock } from "lucide-react"

import { formatToLocal } from "@/lib/utils"
import { copyToClipboard } from "@/lib/clipboard"

interface LogsTableProps {
    data: LogListItemDTO[];
    sorting: SortingState;
    onSortingChange: OnChangeFn<SortingState>;
    onViewDetail: (id: string) => void;
}

function formatTokens(n: number | null | undefined): string {
    if (n === null || n === undefined) return "—"
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
    return n.toString()
}

function formatLatency(ms: number | null | undefined): string {
    if (ms === null || ms === undefined) return "—"
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(2)}s`
}

export function LogsTable({ data, sorting, onSortingChange, onViewDetail }: LogsTableProps) {
    const columns: ColumnDef<LogListItemDTO>[] = [
        {
            accessorKey: "id",
            header: () => <div className="text-center">Trace ID</div>,
            cell: ({ row }) => (
                <div className="flex items-center justify-center gap-1 group">
                    <span className="font-mono text-xs text-muted-foreground">{row.original.id.slice(0, 8)}</span>
                    <Files
                        className="h-3 w-3 opacity-0 group-hover:opacity-100 cursor-pointer text-muted-foreground transition-opacity"
                        onClick={(e) => {
                            e.stopPropagation();
                            void copyToClipboard(row.original.id);
                        }}
                    />
                </div>
            )
        },
        {
            accessorKey: "created_at",
            header: ({ column }) => {
                return (
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                        className="-ml-3 h-8"
                    >
                        Time
                        <ArrowUpDown className="ml-2 h-3 w-3" />
                    </Button>
                )
            },
            cell: ({ row }) => (
                <div className="whitespace-nowrap text-xs text-muted-foreground">
                    {formatToLocal(row.getValue("created_at"), "MMM d, HH:mm:ss")}
                </div>
            )
        },
        {
            accessorKey: "username",
            header: "User",
            cell: ({ row }) => {
                const label = row.original.username || row.original.user_id
                return (
                    <div className="text-xs truncate max-w-[100px]" title={row.original.username ? `${row.original.username} (${row.original.user_id})` : row.original.user_id}>
                        {label}
                    </div>
                )
            }
        },
        {
            accessorKey: "model_name",
            header: "Model",
            cell: ({ row }) => <Badge variant="outline" className="font-mono font-normal text-[10px]">{row.getValue("model_name")}</Badge>
        },
        {
            accessorKey: "capability",
            header: "Capability",
            cell: ({ row }) => {
                const cap = row.original.capability
                return cap
                    ? <Badge variant="secondary" className="font-normal text-[10px]">{capabilityLabel(cap)}</Badge>
                    : <span className="text-muted-foreground text-xs">—</span>
            }
        },
        {
            id: "tokens",
            header: () => (
                <div className="flex items-center gap-1 justify-end">
                    <Zap className="h-3 w-3" /> Tokens
                </div>
            ),
            cell: ({ row }) => {
                const { prompt_tokens, completion_tokens, total_tokens } = row.original
                const hasBreakdown = prompt_tokens != null || completion_tokens != null
                const title = hasBreakdown
                    ? `prompt: ${formatTokens(prompt_tokens)} / completion: ${formatTokens(completion_tokens)}`
                    : undefined
                return (
                    <div className="text-right text-xs font-mono whitespace-nowrap" title={title}>
                        {total_tokens != null ? (
                            <>
                                <span className="text-foreground font-medium">{formatTokens(total_tokens)}</span>
                                {hasBreakdown && (
                                    <span className="text-muted-foreground/70 ml-1">
                                        ({formatTokens(prompt_tokens)} / {formatTokens(completion_tokens)})
                                    </span>
                                )}
                            </>
                        ) : (
                            <span className="text-muted-foreground">—</span>
                        )}
                    </div>
                )
            }
        },
        {
            accessorKey: "total_latency_ms",
            header: ({ column }) => (
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                    className="-ml-3 h-8"
                >
                    <Clock className="h-3 w-3 mr-1" /> Latency
                    <ArrowUpDown className="ml-2 h-3 w-3" />
                </Button>
            ),
            cell: ({ row }) => {
                const total = row.original.total_latency_ms
                const ttft = row.original.first_token_latency_ms
                const title = ttft != null
                    ? `TTFT: ${formatLatency(ttft)} · Total: ${formatLatency(total)}`
                    : undefined
                return (
                    <div className="text-right text-xs font-mono whitespace-nowrap" title={title}>
                        {total != null ? (
                            <>
                                <span className={total > 5000 ? "text-amber-600 dark:text-amber-400" : "text-foreground"}>
                                    {formatLatency(total)}
                                </span>
                                {ttft != null && (
                                    <span className="text-muted-foreground/70 ml-1">
                                        (TTFT {formatLatency(ttft)})
                                    </span>
                                )}
                            </>
                        ) : (
                            <span className="text-muted-foreground">—</span>
                        )}
                    </div>
                )
            }
        },
        {
            accessorKey: "status",
            header: () => <div className="text-left">Status</div>,
            cell: ({ row }) => {
                const status = row.getValue("status") as string
                return (
                    <Badge className="text-[10px] uppercase" variant={status === "completed" ? "default" : status === "failed" ? "destructive" : "secondary"}>
                        {status}
                    </Badge>
                )
            }
        }
    ]

    const table = useReactTable({
        data,
        columns,
        getCoreRowModel: getCoreRowModel(),
        onSortingChange: onSortingChange,
        state: {
            sorting,
        },
        manualSorting: true, // Server-side sorting
    })

    return (
        <DataTableShell>
            <DataTableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                    <DataTableHeaderRow key={headerGroup.id}>
                        {headerGroup.headers.map((header) => (
                            <DataTableHead key={header.id} className="last:text-right">
                                {header.isPlaceholder
                                    ? null
                                    : flexRender(
                                        header.column.columnDef.header,
                                        header.getContext()
                                    )}
                            </DataTableHead>
                        ))}
                    </DataTableHeaderRow>
                ))}
            </DataTableHeader>
            <DataTableBody>
                {table.getRowModel().rows?.length ? (
                    table.getRowModel().rows.map((row) => (
                        <DataTableRow
                            key={row.id}
                            data-state={row.getIsSelected() && "selected"}
                            onClick={() => onViewDetail(row.original.id)}
                        >
                            {row.getVisibleCells().map((cell) => (
                                <DataTableCell key={cell.id}>
                                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                </DataTableCell>
                            ))}
                        </DataTableRow>
                    ))
                ) : (
                    <DataTableEmpty colSpan={columns.length}>
                        No logs found.
                    </DataTableEmpty>
                )}
            </DataTableBody>
        </DataTableShell>
    )
}
