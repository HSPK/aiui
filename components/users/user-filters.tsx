"use client"

import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { RefreshButton } from "@/components/ui/refresh-button"
import { Plus } from "lucide-react"

interface UserFiltersProps {
    keyword: string
    onKeywordChange: (v: string) => void
    filterAdmin: string
    onFilterAdminChange: (v: string) => void
    onSearch: () => void
    onClear: () => void
    onRefresh: () => void
    onAdd: () => void
    isFiltering: boolean
    isRefreshing?: boolean
}

export function UserFilters({
    keyword,
    onKeywordChange,
    filterAdmin,
    onFilterAdminChange,
    onSearch,
    onClear,
    onRefresh,
    onAdd,
    isFiltering,
    isRefreshing,
}: UserFiltersProps) {
    return (
        <div className="flex items-center gap-2 py-1 px-1">
            <div className="flex flex-1 items-center gap-2 overflow-x-auto no-scrollbar">
                <Input
                    placeholder="Username"
                    value={keyword}
                    onChange={(e) => onKeywordChange(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && onSearch()}
                    className="w-[140px] md:w-[180px] h-8 text-xs shrink-0"
                />
                <Select value={filterAdmin} onValueChange={onFilterAdminChange}>
                    <SelectTrigger aria-label="Filter by role" className="w-[120px] h-8 text-xs shrink-0">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Roles</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                        <SelectItem value="user">User</SelectItem>
                    </SelectContent>
                </Select>

                <div className="h-4 w-px bg-border mx-1 hidden md:block shrink-0" />

                <Button onClick={onSearch} size="sm" variant="secondary" className="h-8 text-xs shrink-0">
                    Filter
                </Button>
                {isFiltering && (
                    <Button onClick={onClear} size="sm" variant="ghost" className="h-8 text-xs shrink-0 px-2 text-muted-foreground">
                        Reset
                    </Button>
                )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0 pl-2 border-l border-border/50">
                <RefreshButton onClick={onRefresh} isLoading={isRefreshing} tooltip="Refresh users" />
                <Button onClick={onAdd} size="sm" className="h-8 text-xs gap-1.5 shadow-sm">
                    <Plus className="h-3.5 w-3.5" />
                    Add User
                </Button>
            </div>
        </div>
    )
}
