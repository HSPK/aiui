"use client"

import { Button } from "@/components/ui/button"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { ChevronLeft, ChevronRight } from "lucide-react"

interface TablePaginationProps {
    page: number
    pageSize: number
    total: number
    isLoading?: boolean
    onPageChange: (page: number) => void
    onPageSizeChange: (size: number) => void
    pageSizeOptions?: number[]
}

export function TablePagination({
    page,
    pageSize,
    total,
    isLoading,
    onPageChange,
    onPageSizeChange,
    pageSizeOptions = [10, 20, 50, 100],
}: TablePaginationProps) {
    const totalPages = Math.ceil(total / pageSize) || 1
    const start = total > 0 ? (page - 1) * pageSize + 1 : 0
    const end = Math.min(page * pageSize, total)

    return (
        <div className="border-t bg-muted/20 px-3 py-2 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3">
                <div className="text-xs text-muted-foreground tabular-nums">
                    {total > 0 ? (
                        <>
                            <span className="font-medium">{start}</span>
                            <span className="mx-0.5">-</span>
                            <span className="font-medium">{end}</span>
                            <span className="mx-1 text-muted-foreground/70">of</span>
                            <span className="font-medium">{total}</span>
                        </>
                    ) : (
                        "No data"
                    )}
                </div>
                <div className="hidden sm:flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground/70">Rows:</span>
                    <Select
                        value={pageSize.toString()}
                        onValueChange={(v) => onPageSizeChange(Number(v))}
                    >
                        <SelectTrigger className="h-7 w-[60px] text-xs border-0 bg-transparent hover:bg-muted/50 focus:ring-0 focus:ring-offset-0 px-2">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent align="start">
                            {pageSizeOptions.map((size) => (
                                <SelectItem key={size} value={size.toString()}>
                                    {size}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </div>
            <div className="flex items-center gap-0.5">
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => onPageChange(page - 1)}
                    disabled={page <= 1 || isLoading}
                >
                    <ChevronLeft className="h-4 w-4" />
                </Button>
                <div className="text-xs font-medium min-w-[3.5rem] text-center tabular-nums text-muted-foreground">
                    {page} / {totalPages}
                </div>
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => onPageChange(page + 1)}
                    disabled={page >= totalPages || isLoading}
                >
                    <ChevronRight className="h-4 w-4" />
                </Button>
            </div>
        </div>
    )
}
