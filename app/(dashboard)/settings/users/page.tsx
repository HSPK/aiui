"use client"

import { users } from "@/lib/api";
import type { UserDTO, UserFilterParams } from "@/lib/schemas/user";
import { useState, useCallback } from "react"

import { useAuth } from "@/context/auth-context"
import { UsersTable } from "@/components/users/users-table"
import { UserFormDialog } from "@/components/users/user-form-dialog"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { UserFilters } from "@/components/users/user-filters"
import { TablePagination } from "@/components/ui/table-pagination"
import { ShieldAlert } from "lucide-react"
import { toast } from "sonner"
import { useTableQueryState } from "@/lib/hooks/use-table-query-state"

export default function UsersPage() {
    const { user: currentUser } = useAuth()

    const table = useTableQueryState()

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
        page: table.page,
        page_size: table.pageSize,
        sort: table.sort,
        keyword: activeFilters.keyword || undefined,
        filter_admin: activeFilters.filterAdmin === "admin" ? true : activeFilters.filterAdmin === "user" ? false : undefined,
    }

    const { data, isLoading, isFetching, refetch } = users.useList(queryParams, {
        enabled: currentUser?.role === "admin",
    })

    const deleteMutation = users.useDelete({
        onSuccess: () => {
            toast.success("User deleted successfully")
            setDeletingUser(null)
        },
        onError: (err) => toast.error(err.message || "Delete failed"),
    })

    // Handlers
    const handleSearch = useCallback(() => {
        table.setPage(1)
        setActiveFilters({ keyword, filterAdmin })
    }, [keyword, filterAdmin, table])

    const handleClear = useCallback(() => {
        setKeyword("")
        setFilterAdmin("all")
        setActiveFilters({ keyword: "", filterAdmin: "all" })
        table.setPage(1)
    }, [table])

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
                    <p className="text-muted-foreground">User management is restricted to administrators only.</p>
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
                            sorting={table.sorting}
                            onSortingChange={table.setSorting}
                            currentUser={currentUser}
                            onEdit={setEditingUser}
                            onDelete={setDeletingUser}
                            onRowClick={setEditingUser}
                        />
                    </div>

                    <TablePagination
                        page={table.page}
                        pageSize={table.pageSize}
                        total={data?.total || 0}
                        isLoading={isLoading}
                        onPageChange={table.setPage}
                        onPageSizeChange={table.setPageSize}
                    />
                </div>

                {/* Dialogs */}
                <UserFormDialog open={isCreateOpen} onOpenChange={setIsCreateOpen} mode="create" />
                <UserFormDialog open={!!editingUser} onOpenChange={(o) => !o && setEditingUser(null)} mode="edit" user={editingUser} />
                <ConfirmDialog
                    open={!!deletingUser}
                    onOpenChange={(o) => !o && setDeletingUser(null)}
                    title="Delete user?"
                    description={<>This will permanently delete user <span className="font-medium text-foreground">"{deletingUser?.username}"</span>. This action cannot be undone.</>}
                    confirmLabel="Delete"
                    destructive
                    isLoading={deleteMutation.isPending}
                    onConfirm={() => deletingUser && deleteMutation.mutate(deletingUser.username)}
                />
            </div>
        </div>
    )
}
