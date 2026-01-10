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
import { format } from "date-fns"
import { GenerationLog } from "@/lib/types"

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
            header: "Trace ID",
            cell: ({ row }) => (
                <div className="flex items-center gap-1 group">
                    <span className="font-mono text-xs">{row.original.id.slice(0, 8)}</span>
                    <Files
                        className="h-3 w-3 opacity-0 group-hover:opacity-100 cursor-pointer text-muted-foreground"
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
                    {format(new Date(row.getValue("created_at")), "MMM d, HH:mm:ss")}
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
                <div className="max-w-[150px] truncate text-xs text-muted-foreground" title={row.getValue("input")}>
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
            header: "Status",
            cell: ({ row }) => {
                const status = row.getValue("status") as string
                return (
                    <Badge className="text-[10px] uppercase" variant={status === "completed" ? "default" : status === "failed" ? "destructive" : "secondary"}>
                        {status}
                    </Badge>
                )
            }
        },
        {
            id: "actions",
            cell: ({ row }) => (
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onViewDetail(row.original.id)}>
                    <Eye className="h-4 w-4" />
                </Button>
            )
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
        <div className="rounded-md border">
            <Table>
                <TableHeader>
                    {table.getHeaderGroups().map((headerGroup) => (
                        <TableRow key={headerGroup.id}>
                            {headerGroup.headers.map((header) => {
                                return (
                                    <TableHead key={header.id}>
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
                                className="cursor-pointer hover:bg-muted/50"
                                onClick={() => onViewDetail(row.original.id)}
                            >
                                {row.getVisibleCells().map((cell) => (
                                    <TableCell key={cell.id}>
                                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                    </TableCell>
                                ))}
                            </TableRow>
                        ))
                    ) : (
                        <TableRow>
                            <TableCell colSpan={columns.length} className="h-24 text-center">
                                No results.
                            </TableCell>
                        </TableRow>
                    )}
                </TableBody>
            </Table>
        </div>
    )
}
