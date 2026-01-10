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
        <div className="space-y-6 h-full flex flex-col">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => refetch()}>
                        <RefreshCcw className="h-4 w-4 mr-2" />
                        Refresh
                    </Button>
                </div>
            </div>

            {/* Filters */}
            <div className="flex flex-col md:flex-row gap-4 p-4 border rounded-lg bg-card md:items-end">
                <div className="flex-1 space-y-2">
                    <label className="text-sm font-medium">User ID</label>
                    <Input
                        placeholder="Filter by user..."
                        value={userId}
                        onChange={(e) => setUserId(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                    />
                </div>
                <div className="flex-1 space-y-2">
                    <label className="text-sm font-medium">Model Name</label>
                    <Input
                        placeholder="Filter by model..."
                        value={modelName}
                        onChange={(e) => setModelName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                    />
                </div>
                <div className="w-full md:w-48 space-y-2">
                    <label className="text-sm font-medium">Status</label>
                    <Select value={status} onValueChange={(val: any) => { setStatus(val); setPage(1); }}>
                        <SelectTrigger>
                            <SelectValue placeholder="All Status" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Status</SelectItem>
                            <SelectItem value="completed">Completed</SelectItem>
                            <SelectItem value="failed">Failed</SelectItem>
                            <SelectItem value="pending">Pending</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <div className="flex items-center gap-2 pb-0.5">
                    <Button onClick={handleSearch}>
                        <Search className="h-4 w-4 mr-2" />
                        Search
                    </Button>
                    <Button variant="ghost" onClick={handleClear}>
                        Clear
                    </Button>
                </div>
            </div>

            {/* Table Area */}
            <div className="flex-1 border rounded-md min-h-[400px] bg-card relative">
                {isLoading && !data && (
                    <div className="absolute inset-0 flex items-center justify-center bg-background/50 z-10">
                        <p className="text-muted-foreground">Loading logs...</p>
                    </div>
                )}
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

            {/* Pagination Controls */}
            <div className="flex items-center justify-between">
                <div className="text-sm text-muted-foreground">
                    {data ? (
                        <>
                            Showing {((page - 1) * pageSize) + 1} to {Math.min(page * pageSize, data.total)} of {data.total} entries
                        </>
                    ) : (
                        "No data"
                    )}
                </div>
                <div className="flex items-center space-x-2">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage(p => Math.max(1, p - 1))}
                        disabled={page === 1 || isLoading}
                    >
                        <ChevronLeft className="h-4 w-4" />
                        Previous
                    </Button>
                    <div className="flex items-center gap-1 text-sm font-medium min-w-[3rem] justify-center">
                        Page {page} of {totalPages || 1}
                    </div>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                        disabled={page >= totalPages || isLoading}
                    >
                        Next
                        <ChevronRight className="h-4 w-4" />
                    </Button>
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
