"use client"

import type { LogListItemDTO } from "@/lib/schemas/log";
import {
    ColumnDef,
    flexRender,
    getCoreRowModel,
    useReactTable,
    SortingState,
    OnChangeFn,
} from "@tanstack/react-table"

import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ArrowUpDown, Files, Zap, Clock } from "lucide-react"

import { formatToLocal } from "@/lib/utils"

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
                            navigator.clipboard.writeText(row.original.id);
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
            accessorKey: "user_id",
            header: "User",
            cell: ({ row }) => <div className="text-xs truncate max-w-[100px]" title={row.getValue("user_id")}>{row.getValue("user_id")}</div>
        },
        {
            accessorKey: "model_name",
            header: "Model",
            cell: ({ row }) => <Badge variant="outline" className="font-mono font-normal text-[10px]">{row.getValue("model_name")}</Badge>
        },
        {
            accessorKey: "capability",
            header: "CapabilityDTO",
            cell: ({ row }) => {
                const cap = row.original.capability
                return cap
                    ? <Badge variant="secondary" className="font-mono font-normal text-[10px]">{cap}</Badge>
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
        <div className="overflow-hidden">
            <Table>
                <TableHeader className="bg-muted/40 sticky top-0 z-10">
                    {table.getHeaderGroups().map((headerGroup) => (
                        <TableRow key={headerGroup.id} className="hover:bg-transparent border-b-muted/60 shadow-sm">
                            {headerGroup.headers.map((header) => {
                                return (
                                    <TableHead key={header.id} className="h-10 text-xs font-semibold tracking-wide uppercase text-muted-foreground/80 last:text-right first:pl-4 last:pr-4">
                                        {header.isPlaceholder
                                            ? null
                                            : flexRender(
                                                header.column.columnDef.header,
                                                header.getContext()
                                            )}
                                    </TableHead>
                                )
                            })}
                        </TableRow>
                    ))}
                </TableHeader>
                <TableBody>
                    {table.getRowModel().rows?.length ? (
                        table.getRowModel().rows.map((row) => (
                            <TableRow
                                key={row.id}
                                data-state={row.getIsSelected() && "selected"}
                                className="cursor-pointer hover:bg-muted/90 even:bg-muted/50 border-b-muted/20 h-10 group"
                                onClick={() => onViewDetail(row.original.id)}
                            >
                                {row.getVisibleCells().map((cell) => (
                                    <TableCell key={cell.id} className="py-2 first:pl-4 last:pr-4">
                                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                    </TableCell>
                                ))}
                            </TableRow>
                        ))
                    ) : (
                        <TableRow>
                            <TableCell colSpan={columns.length} className="h-full min-h-[200px] text-center text-muted-foreground align-middle">
                                No logs found.
                            </TableCell>
                        </TableRow>
                    )}
                </TableBody>
            </Table>
        </div>
    )
}
