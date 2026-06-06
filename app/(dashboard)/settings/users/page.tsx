"use client"

import type { UserDTO, UserFilterParams } from "@/lib/schemas/user";
import { useState, useCallback } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"

import { useAuth } from "@/context/auth-context"
import { UsersTable } from "@/components/users/users-table"
import { UserFormDialog } from "@/components/users/user-form-dialog"
import { DeleteUserDialog } from "@/components/users/delete-user-dialog"
import { UserFilters } from "@/components/users/user-filters"
import { TablePagination } from "@/components/ui/table-pagination"
import { ShieldAlert } from "lucide-react"
import { toast } from "sonner"
import { SortingState } from "@tanstack/react-table"

export default function UsersPage() {
    const { user: currentUser } = useAuth()
    const queryClient = useQueryClient()

    // Pagination & sorting
    const [page, setPage] = useState(1)
    const [pageSize, setPageSize] = useState(20)
    const [sorting, setSorting] = useState<SortingState>([{ id: "created_at", desc: true }])

    // Filter inputs
    const [keyword, setKeyword] = useState("")
    const [filterAdmin, setFilterAdmin] = useState("all")
    const [activeFilters, setActiveFilters] = useState({ keyword: "", filterAdmin: "all" })

    // Dialogs
    const [isCreateOpen, setIsCreateOpen] = useState(false)
    const [editingUser, setEditingUser] = useState<UserDTO | null>(null)
    const [deletingUser, setDeletingUser] = useState<UserDTO | null>(null)

    // Build query params
    const queryParams: UserFilterParams = {
        page,
        page_size: pageSize,
        sort: sorting[0] ? `${sorting[0].desc ? "-" : ""}${sorting[0].id}` : "-created_at",
        keyword: activeFilters.keyword || undefined,
        filter_admin: activeFilters.filterAdmin === "admin" ? true : activeFilters.filterAdmin === "user" ? false : undefined,
    }

    const { data, isLoading, isFetching, refetch } = useQuery({
        queryKey: ["users", queryParams],
        queryFn: () => api.getUsers(queryParams),
        enabled: currentUser?.role === "admin",
        placeholderData: (prev) => prev,
    })

    const deleteMutation = useMutation({
        mutationFn: api.deleteUser,
        onSuccess: () => {
            toast.success("UserDTO deleted successfully")
            queryClient.invalidateQueries({ queryKey: ["users"] })
            setDeletingUser(null)
        },
        onError: (err: Error) => toast.error(err.message || "Delete failed"),
    })

    // Handlers
    const handleSearch = useCallback(() => {
        setPage(1)
        setActiveFilters({ keyword, filterAdmin })
    }, [keyword, filterAdmin])

    const handleClear = useCallback(() => {
        setKeyword("")
        setFilterAdmin("all")
        setActiveFilters({ keyword: "", filterAdmin: "all" })
        setPage(1)
    }, [])

    const handlePageSizeChange = useCallback((size: number) => {
        setPageSize(size)
        setPage(1)
    }, [])

    const isFiltering = !!activeFilters.keyword || activeFilters.filterAdmin !== "all"

    // Access denied
    if (currentUser?.role !== "admin") {
        return (
            <div className="h-full flex flex-col items-center justify-center p-8">
                <div className="flex flex-col items-center gap-4 text-center max-w-md">
                    <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
                        <ShieldAlert className="h-8 w-8 text-destructive" />
                    </div>
                    <h1 className="text-2xl font-semibold">Access Denied</h1>
                    <p className="text-muted-foreground">UserDTO management is restricted to administrators only.</p>
                </div>
            </div>
        )
    }

    return (
        <div className="h-full flex flex-col p-4 overflow-y-hidden">
            <div className="flex-1 flex flex-col min-h-0 space-y-2">
                {/* Filters */}
                <UserFilters
                    keyword={keyword}
                    onKeywordChange={setKeyword}
                    filterAdmin={filterAdmin}
                    onFilterAdminChange={setFilterAdmin}
                    onSearch={handleSearch}
                    onClear={handleClear}
                    onRefresh={() => refetch()}
                    onAdd={() => setIsCreateOpen(true)}
                    isFiltering={isFiltering}
                    isRefreshing={isFetching}
                />

                {/* Table */}
                <div className="flex-1 border rounded-xl bg-card shadow-sm flex flex-col overflow-hidden relative">
                    {isLoading && !data && (
                        <div className="absolute inset-0 flex items-center justify-center bg-background/50 z-10">
                            <p className="text-muted-foreground animate-pulse">Loading...</p>
                        </div>
                    )}

                    <div className="flex-1 overflow-auto">
                        <UsersTable
                            data={data?.items || []}
                            sorting={sorting}
                            onSortingChange={setSorting}
                            currentUser={currentUser}
                            onEdit={setEditingUser}
                            onDelete={setDeletingUser}
                            onRowClick={setEditingUser}
                        />
                    </div>

                    <TablePagination
                        page={page}
                        pageSize={pageSize}
                        total={data?.total || 0}
                        isLoading={isLoading}
                        onPageChange={setPage}
                        onPageSizeChange={handlePageSizeChange}
                    />
                </div>

                {/* Dialogs */}
                <UserFormDialog open={isCreateOpen} onOpenChange={setIsCreateOpen} mode="create" />
                <UserFormDialog open={!!editingUser} onOpenChange={(o) => !o && setEditingUser(null)} mode="edit" user={editingUser} />
                <DeleteUserDialog
                    open={!!deletingUser}
                    onOpenChange={(o) => !o && setDeletingUser(null)}
                    user={deletingUser}
                    isLoading={deleteMutation.isPending}
                    onConfirm={() => deletingUser && deleteMutation.mutate(deletingUser.username)}
                />
            </div>
        </div>
    )
}
