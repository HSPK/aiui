"use client"

import {
    ColumnDef,
    flexRender,
    getCoreRowModel,
    useReactTable,
    SortingState,
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
import { ArrowUpDown, Eye, Files } from "lucide-react"
import { GenerationLog } from "@/lib/types"
import { formatToLocal } from "@/lib/utils"

interface LogsTableProps {
    data: GenerationLog[];
    sorting: SortingState;
    onSortingChange: (sorting: any) => void;
    onViewDetail: (id: string) => void;
}

export function LogsTable({ data, sorting, onSortingChange, onViewDetail }: LogsTableProps) {
    const columns: ColumnDef<GenerationLog>[] = [
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
            accessorKey: "input",
            header: "Prompt",
            cell: ({ row }) => (
                <div className="max-w-[200px] truncate text-xs text-muted-foreground" title={row.getValue("input")}>
                    {row.getValue("input")}
                </div>
            )
        },
        {
            accessorKey: "output",
            header: "Completion",
            cell: ({ row }) => (
                <div className="max-w-[200px] truncate text-xs text-muted-foreground" title={row.getValue("output")}>
                    {row.getValue("output")}
                </div>
            )
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
