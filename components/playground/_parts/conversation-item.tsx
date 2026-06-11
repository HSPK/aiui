"use client"

import * as React from "react"
import Link from "next/link"
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
 * Single conversation row in the sidebar list.
 *
 * Navigation uses Next.js `<Link>` so clicking does an SPA soft-nav —
 * no full page reload, sidebar scroll preserved, in-flight queries
 * survive. This requires Next.js's router to actually commit the URL
 * change, which depends on the page itself not blocking the navigation
 * transition (see chat page header for the history of why we removed
 * the auto-mint router.replace effect).
 */
export const ConversationItem = React.memo(function ConversationItem({
    conv,
    isSelected,
    href,
    onPick,
    onDeleteRequest,
    onRename,
    compact = true,
}: {
    conv: ConversationDTO
    isSelected: boolean
    /** Already-computed URL for this row (sidebar owns formatting). */
    href: string
    /** Optional post-click side effect (e.g., close mobile sheet). */
    onPick?: (conv: ConversationDTO) => void
    onDeleteRequest: (conv: ConversationDTO) => void
    onRename: (conv: ConversationDTO, newTitle: string) => void
    /** Desktop sidebar (`true`, default) uses tight padding + text-sm.
     *  Mobile Sheet (`false`) uses bigger touch targets + text-base. */
    compact?: boolean
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
        if (trimmed && trimmed !== conv.title) onRename(conv, trimmed)
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
        onDeleteRequest(conv)
    }

    const handleRowClick = () => onPick?.(conv)

    if (isEditing) {
        return (
            <div className="flex items-center gap-1.5 rounded-md px-2 py-1.5">
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
        <Link
            href={href}
            prefetch={false}
            onClick={(e) => {
                if (isSelected) {
                    e.preventDefault()
                    return
                }
                onPick?.(conv)
                // Soft-nav fallback: some deployment setups (Caddy /
                // Tailscale / specific Next 16 + React 19 combos)
                // silently stall Next.js router transitions. If the
                // URL hasn't picked up the target id within 300 ms,
                // fall back to a full browser navigation so the user's
                // click NEVER goes unanswered. No-op when soft-nav
                // works as expected (the common case).
                const targetSearch = `c=${encodeURIComponent(conv.id)}`
                setTimeout(() => {
                    if (typeof window === "undefined") return
                    if (window.location.search.includes(targetSearch)) return
                    window.location.assign(href)
                }, 300)
            }}
            className={cn(
                "group/item relative flex items-center gap-2 rounded-md cursor-pointer transition-colors no-underline",
                compact ? "px-2 py-1.5 text-sm" : "px-3 h-11 text-base",
                isSelected
                    ? "bg-secondary text-secondary-foreground"
                    : "text-foreground/80 hover:bg-muted hover:text-foreground",
            )}
        >
            <span className="truncate flex-1 min-w-0">{conv.title}</span>
            <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
                <DropdownMenuTrigger asChild>
                    <button
                        type="button"
                        onClick={(e) => { e.preventDefault(); e.stopPropagation() }}
                        className={cn(
                            "shrink-0 rounded transition-opacity inline-flex items-center justify-center",
                            "hover:bg-black/10 dark:hover:bg-white/10",
                            compact ? "p-0.5" : "h-9 w-9",
                            // Touch devices have no hover — always show
                            // the menu trigger when not compact.
                            compact
                                ? (dropdownOpen ? "opacity-100" : "opacity-0 group-hover/item:opacity-100")
                                : "opacity-100",
                        )}
                    >
                        <MoreHorizontal className={compact ? "h-4 w-4" : "h-5 w-5"} />
                    </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                    <DropdownMenuItem onClick={handleStartEdit} className={compact ? "" : "h-11 text-base"}>
                        <Pencil className={compact ? "h-3.5 w-3.5 mr-2" : "h-4 w-4 mr-3"} />
                        Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        onClick={handleDelete}
                        className={cn("text-destructive focus:text-destructive", compact ? "" : "h-11 text-base")}
                    >
                        <Trash2 className={compact ? "h-3.5 w-3.5 mr-2" : "h-4 w-4 mr-3"} />
                        Delete
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </Link>
    )
})

/** Width-varied skeleton rows used while the conversation list is
 *  loading. Lives next to ConversationItem since they share the row
 *  geometry. */
export function ListSkeleton() {
    const widths = [78, 62, 90, 55, 70, 84]
    return (
        <div className="space-y-2 px-2 pt-3">
            <Skeleton className="h-3 w-16" />
            <div className="space-y-1">
                {widths.map((w, i) => (
                    <div key={i} className="px-2 py-1.5">
                        <Skeleton className="h-3.5" style={{ width: `${w}%` }} />
                    </div>
                ))}
            </div>
        </div>
    )
}
