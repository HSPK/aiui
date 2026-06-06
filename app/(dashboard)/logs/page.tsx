"use client"

import { logs } from "@/lib/api";
import type { LogFilterParams } from "@/lib/schemas/log";
import { useState, useCallback } from "react"

import { LogsTable } from "@/components/logs/logs-table"
import { LogDetails } from "@/components/logs/log-details"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { TablePagination } from "@/components/ui/table-pagination"
import { RefreshButton } from "@/components/ui/refresh-button"
import { LoadingState } from "@/components/ui/loading-state"
import { useTableQueryState } from "@/lib/hooks/use-table-query-state"

type StatusFilter = "pending" | "completed" | "failed" | "all"

export default function LogsPage() {
    const table = useTableQueryState()

    // Filter inputs
    const [userId, setUserId] = useState("")
    const [modelName, setModelName] = useState("")
    const [status, setStatus] = useState<StatusFilter>("all")

    // Active filters (applied on search)
    const [activeFilters, setActiveFilters] = useState({ userId: "", modelName: "" })

    // Detail view
    const [selectedLogId, setSelectedLogId] = useState<string | null>(null)
    const [isDetailOpen, setIsDetailOpen] = useState(false)

    // Build query params
    const queryParams: LogFilterParams = {
        page: table.page,
        page_size: table.pageSize,
        sort: table.sort,
        user_id: activeFilters.userId || null,
        model_name: activeFilters.modelName || null,
        status: status === "all" ? null : status,
    }

    const { data, isLoading, isFetching, refetch } = logs.useList(queryParams)

    // Handlers
    const handleSearch = useCallback(() => {
        table.setPage(1)
        setActiveFilters({ userId, modelName })
    }, [userId, modelName, table])

    const handleClear = useCallback(() => {
        setUserId("")
        setModelName("")
        setStatus("all")
        setActiveFilters({ userId: "", modelName: "" })
        table.setPage(1)
    }, [table])

    const handleViewDetail = useCallback((id: string) => {
        setSelectedLogId(id)
        setIsDetailOpen(true)
    }, [])

    const isFiltering = activeFilters.userId || activeFilters.modelName || status !== "all"

    return (
        <div className="h-full flex flex-col p-4 overflow-y-hidden">
            <div className="flex-1 flex flex-col min-h-0 space-y-2">
                {/* Filters Bar */}
                <div className="flex items-center gap-2 py-1 px-1">
                    <div className="flex flex-1 items-center gap-2 overflow-x-auto no-scrollbar">
                        <Input
                            placeholder="User ID"
                            value={userId}
                            onChange={(e) => setUserId(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                            className="w-[140px] md:w-[180px] h-8 text-xs shrink-0"
                        />
                        <Input
                            placeholder="Model name"
                            value={modelName}
                            onChange={(e) => setModelName(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                            className="w-[140px] md:w-[180px] h-8 text-xs shrink-0"
                        />
                        <Select value={status} onValueChange={(v) => { setStatus(v as StatusFilter); table.setPage(1) }}>
                            <SelectTrigger className="w-[120px] h-8 text-xs shrink-0">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Status</SelectItem>
                                <SelectItem value="completed">Completed</SelectItem>
                                <SelectItem value="failed">Failed</SelectItem>
                                <SelectItem value="pending">Pending</SelectItem>
                            </SelectContent>
                        </Select>

                        <div className="h-4 w-px bg-border mx-1 hidden md:block shrink-0" />

                        <Button onClick={handleSearch} size="sm" variant="secondary" className="h-8 text-xs shrink-0">
                            Filter
                        </Button>
                        {isFiltering && (
                            <Button onClick={handleClear} size="sm" variant="ghost" className="h-8 text-xs shrink-0 px-2 text-muted-foreground">
                                Reset
                            </Button>
                        )}
                    </div>

                    <div className="shrink-0 pl-2 border-l border-border/50">
                        <RefreshButton onClick={() => refetch()} isLoading={isFetching} tooltip="Refresh logs" />
                    </div>
                </div>

                {/* Table */}
                <div className="flex-1 border rounded-xl bg-card shadow-sm flex flex-col overflow-hidden relative">
                    {isLoading && !data && (
                        <div className="absolute inset-0 flex items-center justify-center bg-background/50 z-10">
                            <LoadingState />
                        </div>
                    )}

                    <div className="flex-1 overflow-auto">
                        <LogsTable
                            data={data?.items || []}
                            sorting={table.sorting}
                            onSortingChange={table.setSorting}
                            onViewDetail={handleViewDetail}
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

                <LogDetails logId={selectedLogId} open={isDetailOpen} onOpenChange={setIsDetailOpen} />
            </div>
        </div>
    )
}
