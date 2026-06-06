"use client"

import * as React from "react"
import type { SortingState } from "@tanstack/react-table"

interface UseTableQueryStateOptions {
    /** Default column id sorted on. */
    defaultSortId?: string
    /** Default sort direction. */
    defaultDesc?: boolean
    /** Initial page size. */
    defaultPageSize?: number
}

/**
 * Page-state primitive shared by every list page (logs, users, ...): page,
 * pageSize, sorting + a `sort` string in `±field` form ready to spread into
 * a `<resource>.useList({ sort })` query. Changing pageSize resets page to
 * 1 — every caller did this manually before.
 *
 * Returned `sort` is memoized; reflects sorting[0] (TanStack tables are
 * single-column for our pages).
 */
export function useTableQueryState({
    defaultSortId = "created_at",
    defaultDesc = true,
    defaultPageSize = 20,
}: UseTableQueryStateOptions = {}) {
    const [page, setPage] = React.useState(1)
    const [pageSize, setPageSizeRaw] = React.useState(defaultPageSize)
    const [sorting, setSorting] = React.useState<SortingState>([
        { id: defaultSortId, desc: defaultDesc },
    ])

    const setPageSize = React.useCallback((size: number) => {
        setPageSizeRaw(size)
        setPage(1)
    }, [])

    const sort = React.useMemo(() => {
        if (sorting[0]) return `${sorting[0].desc ? "-" : ""}${sorting[0].id}`
        return `${defaultDesc ? "-" : ""}${defaultSortId}`
    }, [sorting, defaultSortId, defaultDesc])

    return { page, pageSize, sorting, sort, setPage, setPageSize, setSorting }
}
