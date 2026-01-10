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
        <div className="h-full flex flex-col p-4 overflow-y-hidden">
            <div className="flex-1 flex flex-col min-h-0 space-y-2">
                {/* Top Controls Bar */}
                <div className="flex items-center gap-2 py-1 px-1">
                    {/* Scrollable Filters */}
                    <div className="flex flex-1 items-center gap-2 overflow-x-auto no-scrollbar scroll-smooth">
                        <Input
                            placeholder="User ID"
                            value={userId}
                            onChange={(e) => setUserId(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                            className="w-[140px] md:w-[180px] h-8 text-xs focus-visible:ring-offset-0 shrink-0"
                        />
                        <Input
                            placeholder="Model name"
                            value={modelName}
                            onChange={(e) => setModelName(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                            className="w-[140px] md:w-[180px] h-8 text-xs focus-visible:ring-offset-0 shrink-0"
                        />
                        <Select value={status} onValueChange={(val: any) => { setStatus(val); setPage(1); }}>
                            <SelectTrigger className="w-[110px] md:w-[140px] h-8 text-xs shrink-0">
                                <SelectValue placeholder="Status" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Status</SelectItem>
                                <SelectItem value="completed">Completed</SelectItem>
                                <SelectItem value="failed">Failed</SelectItem>
                                <SelectItem value="pending">Pending</SelectItem>
                            </SelectContent>
                        </Select>

                        <div className="h-4 w-px bg-border mx-1 hidden md:block shrink-0" />

                        <Button
                            onClick={handleSearch}
                            size="sm"
                            variant="secondary"
                            className="h-8 text-xs shrink-0"
                        >
                            Filter
                        </Button>
                        {(activeFilters.userId || activeFilters.modelName || status !== "all") && (
                            <Button
                                variant="ghost"
                                onClick={handleClear}
                                size="sm"
                                className="h-8 text-xs shrink-0 px-2 text-muted-foreground hover:text-foreground"
                            >
                                Reset
                            </Button>
                        )}
                    </div>

                    {/* Fixed Right Actions */}
                    <div className="flex items-center gap-1 shrink-0 pl-2 border-l border-border/50">
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => refetch()}
                            className="h-8 w-8 text-muted-foreground hover:text-foreground"
                            title="Refresh Logs"
                        >
                            <RefreshCcw className="h-4 w-4" />
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
        </div>
    )
}
