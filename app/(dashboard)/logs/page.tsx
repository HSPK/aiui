"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { LogFilterParams } from "@/lib/types"
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
import { ChevronLeft, ChevronRight, RefreshCcw, Search } from "lucide-react"
import { SortingState } from "@tanstack/react-table"

export default function LogsPage() {
    // State for filters and pagination
    const [page, setPage] = useState(1)
    const [pageSize, setPageSize] = useState(20)
    const [sorting, setSorting] = useState<SortingState>([{ id: "created_at", desc: true }])

    // Filter states
    const [userId, setUserId] = useState("")
    const [modelName, setModelName] = useState("")
    const [status, setStatus] = useState<"pending" | "completed" | "failed" | "all">("all")

    // Search Trigger (de-bounce or manual?) Using simple effect for now or button
    const [activeFilters, setActiveFilters] = useState({
        userId: "",
        modelName: ""
    })

    // Detail View State
    const [selectedLogId, setSelectedLogId] = useState<string | null>(null)
    const [isDetailOpen, setIsDetailOpen] = useState(false)

    // Construct query params
    const queryParams: LogFilterParams = {
        page,
        page_size: pageSize,
        sort: sorting.length > 0 ? `${sorting[0].desc ? "-" : ""}${sorting[0].id}` : "-created_at",
        user_id: activeFilters.userId || null,
        model_name: activeFilters.modelName || null,
        status: status === "all" ? null : status
    }

    const { data, isLoading, isPlaceholderData, refetch } = useQuery({
        queryKey: ["logs", queryParams],
        queryFn: () => api.getLogs(queryParams),
        placeholderData: (previousData) => previousData, // Keep data while fetching new page
    })

    const handleSearch = () => {
        setPage(1) // Reset to page 1 on search
        setActiveFilters({
            userId,
            modelName
        })
    }

    const handleClear = () => {
        setUserId("")
        setModelName("")
        setStatus("all")
        setActiveFilters({ userId: "", modelName: "" })
        setPage(1)
    }

    const totalPages = data ? Math.ceil(data.total / pageSize) : 0

    return (
        <div className="h-full flex flex-col space-y-4 p-0 md:p-0">
            {/* Top Controls Bar */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 py-2">
                <div className="flex flex-1 items-center gap-3 w-full overflow-x-auto p-1 no-scrollbar">
                    <Input
                        placeholder="Filter user ID"
                        value={userId}
                        onChange={(e) => setUserId(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                        className="w-[150px] h-9 focus-visible:ring-offset-0"
                    />
                    <Input
                        placeholder="Filter model name"
                        value={modelName}
                        onChange={(e) => setModelName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                        className="w-[150px] h-9 focus-visible:ring-offset-0"
                    />
                    <Select value={status} onValueChange={(val: any) => { setStatus(val); setPage(1); }}>
                        <SelectTrigger className="w-[140px] h-9">
                            <SelectValue placeholder="All Status" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Status</SelectItem>
                            <SelectItem value="completed">Completed</SelectItem>
                            <SelectItem value="failed">Failed</SelectItem>
                            <SelectItem value="pending">Pending</SelectItem>
                        </SelectContent>
                    </Select>
                    <div className="h-4 w-px bg-border mx-2 hidden md:block" />
                    <Button
                        onClick={handleSearch}
                        size="sm"
                        variant="secondary"
                        className="h-9 shrink-0"
                    >
                        Apply Filters
                    </Button>
                    {(activeFilters.userId || activeFilters.modelName || status !== "all") && (
                        <Button
                            variant="ghost"
                            onClick={handleClear}
                            size="sm"
                            className="h-9 shrink-0 px-2 lg:px-4"
                        >
                            Reset
                        </Button>
                    )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                    <Button variant="outline" size="sm" onClick={() => refetch()} className="h-9">
                        <RefreshCcw className="h-3.5 w-3.5 mr-2" />
                        Refresh
                    </Button>
                </div>
            </div>

            {/* Table Area */}
            <div className="flex-1 border rounded-xl bg-card shadow-sm flex flex-col overflow-hidden relative">
                {isLoading && !data && (
                    <div className="absolute inset-0 flex items-center justify-center bg-background/50 z-10">
                        <p className="text-muted-foreground animate-pulse">Loading logs...</p>
                    </div>
                )}

                <div className="flex-1 overflow-auto">
                    <LogsTable
                        data={data?.items || []}
                        sorting={sorting}
                        onSortingChange={setSorting}
                        onViewDetail={(id) => {
                            setSelectedLogId(id)
                            setIsDetailOpen(true)
                        }}
                    />
                </div>

                {/* Pagination Footer */}
                <div className="border-t bg-muted/20 p-2 flex items-center justify-between shrink-0">
                    <div className="text-xs text-muted-foreground px-2">
                        {data ? (
                            <>
                                Showing <span className="font-medium">{((page - 1) * pageSize) + 1}</span> to <span className="font-medium">{Math.min(page * pageSize, data.total)}</span> of <span className="font-medium">{data.total}</span>
                            </>
                        ) : (
                            "No data"
                        )}
                    </div>
                    <div className="flex items-center space-x-2">
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            onClick={() => setPage(p => Math.max(1, p - 1))}
                            disabled={page === 1 || isLoading}
                        >
                            <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <div className="flex items-center gap-1 text-xs font-medium min-w-[3rem] justify-center">
                            {page} / {totalPages || 1}
                        </div>
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                            disabled={page >= totalPages || isLoading}
                        >
                            <ChevronRight className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
            </div>

            <LogDetails
                logId={selectedLogId}
                open={isDetailOpen}
                onOpenChange={setIsDetailOpen}
            />
        </div>
    )
}
