"use client"

import * as React from "react"
import {
    Check,
    MessageSquare,
    MoreHorizontal,
    Pencil,
    Trash2,
    X,
} from "lucide-react"

import { cn } from "@/lib/utils"
import type { ConversationDTO } from "@/lib/schemas/conversation"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * Single conversation row in the sidebar list — display + inline
 * rename + delete dropdown. Extracted from conversation-sidebar so
 * row-level visual / interaction tweaks (drag handles, multi-select,
 * etc.) localize here.
 */
export function ConversationItem({
    conv,
    isSelected,
    onOpen,
    onDeleteRequest,
    onRename,
}: {
    conv: ConversationDTO
    isSelected: boolean
    onOpen: () => void
    onDeleteRequest: () => void
    onRename: (newTitle: string) => void
}) {
    const [isEditing, setIsEditing] = React.useState(false)
    const [editTitle, setEditTitle] = React.useState(conv.title)
    const [dropdownOpen, setDropdownOpen] = React.useState(false)
    const inputRef = React.useRef<HTMLInputElement>(null)
    const isComposingRef = React.useRef(false)

    React.useEffect(() => {
        if (isEditing && inputRef.current) {
            inputRef.current.focus()
            inputRef.current.select()
        }
    }, [isEditing])

    const handleStartEdit = (e: React.MouseEvent) => {
        e.stopPropagation()
        setDropdownOpen(false)
        setEditTitle(conv.title)
        setIsEditing(true)
    }

    const handleSaveEdit = () => {
        const trimmed = editTitle.trim()
        if (trimmed && trimmed !== conv.title) onRename(trimmed)
        setIsEditing(false)
    }

    const handleCancelEdit = () => {
        setEditTitle(conv.title)
        setIsEditing(false)
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !isComposingRef.current) handleSaveEdit()
        else if (e.key === "Escape") handleCancelEdit()
    }

    const handleDelete = (e: React.MouseEvent) => {
        e.stopPropagation()
        setDropdownOpen(false)
        onDeleteRequest()
    }

    if (isEditing) {
        return (
            <div className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5">
                <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground/70" />
                <input
                    ref={inputRef}
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onCompositionStart={() => (isComposingRef.current = true)}
                    onCompositionEnd={() => (isComposingRef.current = false)}
                    onBlur={handleSaveEdit}
                    className="flex-1 min-w-0 bg-transparent text-sm outline-none border-b border-primary/50 py-0.5"
                    onClick={(e) => e.stopPropagation()}
                />
                <button
                    onClick={(e) => { e.stopPropagation(); handleSaveEdit() }}
                    className="p-0.5 hover:bg-green-500/10 rounded text-green-600 shrink-0"
                >
                    <Check className="h-3.5 w-3.5" />
                </button>
                <button
                    onClick={(e) => { e.stopPropagation(); handleCancelEdit() }}
                    className="p-0.5 hover:bg-red-500/10 rounded text-red-600 shrink-0"
                >
                    <X className="h-3.5 w-3.5" />
                </button>
            </div>
        )
    }

    return (
        <div
            onClick={onOpen}
            className={cn(
                "group/item relative flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm cursor-pointer transition-colors",
                isSelected
                    ? "bg-secondary text-secondary-foreground"
                    : "text-foreground/80 hover:bg-muted hover:text-foreground",
            )}
        >
            <span className="truncate flex-1 min-w-0">{conv.title}</span>
            <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
                <DropdownMenuTrigger asChild>
                    <button
                        onClick={(e) => e.stopPropagation()}
                        className={cn(
                            "shrink-0 p-0.5 rounded transition-opacity",
                            "hover:bg-black/10 dark:hover:bg-white/10",
                            dropdownOpen ? "opacity-100" : "opacity-0 group-hover/item:opacity-100",
                        )}
                    >
                        <MoreHorizontal className="h-4 w-4" />
                    </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-36">
                    <DropdownMenuItem onClick={handleStartEdit}>
                        <Pencil className="h-3.5 w-3.5 mr-2" />
                        Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        onClick={handleDelete}
                        className="text-destructive focus:text-destructive"
                    >
                        <Trash2 className="h-3.5 w-3.5 mr-2" />
                        Delete
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    )
}

/** Width-varied skeleton rows used while the conversation list is
 *  loading. Lives next to ConversationItem since they share the row
 *  geometry. */
export function ListSkeleton() {
    const widths = [78, 62, 90, 55, 70, 84]
    return (
        <div className="space-y-2 px-3 pt-3">
            <Skeleton className="h-3 w-16" />
            <div className="space-y-1">
                {widths.map((w, i) => (
                    <div key={i} className="px-2.5 py-1.5">
                        <Skeleton className="h-3.5" style={{ width: `${w}%` }} />
                    </div>
                ))}
            </div>
        </div>
    )
}
