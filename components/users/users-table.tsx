"use client"

import type { UserDTO } from "@/lib/schemas/user";
import {
    ColumnDef,
    SortingState,
    flexRender,
    getCoreRowModel,
    useReactTable,
} from "@tanstack/react-table"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ArrowUpDown, MoreHorizontal, Pencil, Shield, Trash2, User as UserIcon } from "lucide-react"
import { formatToLocal } from "@/lib/utils"

interface UsersTableProps {
    data: UserDTO[]
    sorting: SortingState
    onSortingChange: (sorting: SortingState) => void
    currentUser: UserDTO | null
    onEdit: (user: UserDTO) => void
    onDelete: (user: UserDTO) => void
    onRowClick?: (user: UserDTO) => void
}

export function UsersTable({
    data,
    sorting,
    onSortingChange,
    currentUser,
    onEdit,
    onDelete,
    onRowClick,
}: UsersTableProps) {
    const columns: ColumnDef<UserDTO>[] = [
        {
            accessorKey: "username",
            header: ({ column }) => (
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                    className="-ml-3 h-8"
                >
                    Username
                    <ArrowUpDown className="ml-2 h-3 w-3" />
                </Button>
            ),
            cell: ({ row }) => {
                const username = row.getValue("username") as string
                const isCurrentUser = username === currentUser?.username
                const isAdmin = row.original.role === "admin"
                return (
                    <div className="flex items-center gap-2">
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-medium shrink-0 ${isAdmin ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                            }`}>
                            {username.charAt(0).toUpperCase()}
                        </div>
                        <span className="text-xs font-medium truncate max-w-[120px]" title={username}>
                            {username}
                        </span>
                        {isCurrentUser && (
                            <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 font-normal">
                                me
                            </Badge>
                        )}
                    </div>
                )
            },
        },
        {
            accessorKey: "role",
            header: "Role",
            cell: ({ row }) => {
                const role = row.getValue("role") as string
                return (
                    <Badge
                        variant={role === "admin" ? "default" : "secondary"}
                        className="text-[10px] uppercase font-normal gap-1"
                    >
                        {role === "admin" ? <Shield className="h-2.5 w-2.5" /> : <UserIcon className="h-2.5 w-2.5" />}
                        {role}
                    </Badge>
                )
            },
        },
        {
            accessorKey: "created_at",
            header: ({ column }) => (
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                    className="-ml-3 h-8"
                >
                    Created
                    <ArrowUpDown className="ml-2 h-3 w-3" />
                </Button>
            ),
            cell: ({ row }) => {
                const createdAt = row.getValue("created_at") as string | undefined
                if (!createdAt) return <span className="text-xs text-muted-foreground">-</span>
                return (
                    <div className="whitespace-nowrap text-xs text-muted-foreground">
                        {formatToLocal(createdAt, "MMM d, HH:mm:ss")}
                    </div>
                )
            },
        },
        {
            id: "actions",
            header: () => null,
            cell: ({ row }) => {
                const user = row.original
                const isCurrentUser = user.username === currentUser?.username
                return (
                    <div className="flex justify-end">
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                    <MoreHorizontal className="h-4 w-4" />
                                    <span className="sr-only">Open menu</span>
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-36">
                                <DropdownMenuItem onClick={() => onEdit(user)}>
                                    <Pencil className="mr-2 h-3.5 w-3.5" />
                                    Edit
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                    onClick={() => onDelete(user)}
                                    disabled={isCurrentUser}
                                    className="text-destructive focus:text-destructive"
                                >
                                    <Trash2 className="mr-2 h-3.5 w-3.5" />
                                    Delete
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                )
            },
        },
    ]

    const table = useReactTable({
        data,
        columns,
        state: { sorting },
        onSortingChange: (updater) => {
            const newSorting = typeof updater === "function" ? updater(sorting) : updater
            onSortingChange(newSorting)
        },
        getCoreRowModel: getCoreRowModel(),
        manualSorting: true,
    })

    return (
        <div className="overflow-hidden">
            <Table>
                <TableHeader className="bg-muted/40 sticky top-0 z-10">
                    {table.getHeaderGroups().map((headerGroup) => (
                        <TableRow key={headerGroup.id} className="hover:bg-transparent border-b-muted/60 shadow-sm">
                            {headerGroup.headers.map((header) => (
                                <TableHead key={header.id} className="h-10 text-xs font-semibold tracking-wide uppercase text-muted-foreground/80 last:text-right first:pl-4 last:pr-4">
                                    {header.isPlaceholder
                                        ? null
                                        : flexRender(
                                            header.column.columnDef.header,
                                            header.getContext()
                                        )}
                                </TableHead>
                            ))}
                        </TableRow>
                    ))}
                </TableHeader>
                <TableBody>
                    {table.getRowModel().rows?.length ? (
                        table.getRowModel().rows.map((row) => (
                            <TableRow
                                key={row.id}
                                className="hover:bg-muted/90 even:bg-muted/50 border-b-muted/20 h-10 group cursor-pointer"
                                onClick={() => onRowClick?.(row.original)}
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
                                No users found.
                            </TableCell>
                        </TableRow>
                    )}
                </TableBody>
            </Table>
        </div>
    )
}
