"use client"

import { useQueryClient } from "@tanstack/react-query"
import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"
import {
    Loader2,
    MessageSquare,
    MoreHorizontal,
    Pencil,
    Trash2,
    Check,
    X,
    PanelLeftClose,
    PanelLeft,
    Search,
    SquarePen,
} from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { conversations } from "@/lib/api"
import type { ConversationDTO } from "@/lib/schemas/conversation"
import { usePlaygroundStore } from "@/lib/stores/playground-store"
import { Button } from "@/components/ui/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip"
import { Skeleton } from "@/components/ui/skeleton"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"

// ---------- date grouping ----------

interface ConvGroup {
    key: string
    label: string
    items: ConversationDTO[]
}

function startOfDay(d: Date): number {
    const x = new Date(d)
    x.setHours(0, 0, 0, 0)
    return x.getTime()
}

function groupByUpdatedAt(items: ConversationDTO[]): ConvGroup[] {
    const now = new Date()
    const today = startOfDay(now)
    const yesterday = today - 24 * 60 * 60 * 1000
    const last7 = today - 7 * 24 * 60 * 60 * 1000
    const last30 = today - 30 * 24 * 60 * 60 * 1000

    const buckets = new Map<string, ConvGroup>()
    const order: string[] = []
    const push = (key: string, label: string, item: ConversationDTO) => {
        let g = buckets.get(key)
        if (!g) {
            g = { key, label, items: [] }
            buckets.set(key, g)
            order.push(key)
        }
        g.items.push(item)
    }

    for (const conv of items) {
        const raw = conv.updated_at ?? conv.created_at ?? new Date().toISOString()
        const iso = typeof raw === "string" && raw.length > 0 && !raw.endsWith("Z") && !/[+-]\d\d:?\d\d$/.test(raw)
            ? raw + "Z"
            : raw
        const d = new Date(iso)
        const day = startOfDay(d)
        if (day >= today) push("today", "Today", conv)
        else if (day >= yesterday) push("yesterday", "Yesterday", conv)
        else if (day >= last7) push("last7", "Previous 7 days", conv)
        else if (day >= last30) push("last30", "Previous 30 days", conv)
        else {
            const m = d.toLocaleDateString(undefined, { year: "numeric", month: "long" })
            push(`m-${m}`, m, conv)
        }
    }

    return order.map((k) => buckets.get(k)!)
}

// ---------- item ----------

function ConversationItem({
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
                    onClick={(e) => {
                        e.stopPropagation()
                        handleSaveEdit()
                    }}
                    className="p-0.5 hover:bg-green-500/10 rounded text-green-600 shrink-0"
                >
                    <Check className="h-3.5 w-3.5" />
                </button>
                <button
                    onClick={(e) => {
                        e.stopPropagation()
                        handleCancelEdit()
                    }}
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
                    : "text-foreground/80 hover:bg-muted hover:text-foreground"
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
                            dropdownOpen ? "opacity-100" : "opacity-0 group-hover/item:opacity-100"
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

function ListSkeleton() {
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

// ---------- main ----------

export function ConversationSidebar() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const activeId = searchParams?.get("c") ?? null

    const isOpen = usePlaygroundStore((s) => s.isHistorySidebarOpen)
    const toggleSidebar = usePlaygroundStore((s) => s.toggleHistorySidebar)
    const removeSettings = usePlaygroundStore((s) => s.removeSettings)
    const queryClient = useQueryClient()

    const [searchInput, setSearchInput] = React.useState("")
    const [debouncedSearch, setDebouncedSearch] = React.useState("")
    React.useEffect(() => {
        const t = setTimeout(() => setDebouncedSearch(searchInput.trim()), 220)
        return () => clearTimeout(t)
    }, [searchInput])

    const observerTarget = React.useRef<HTMLDivElement>(null)
    const [pendingDelete, setPendingDelete] = React.useState<ConversationDTO | null>(null)

    const {
        data,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
        isLoading,
    } = conversations.useInfinite({
        pageSize: 30,
        scope: "sidebar",
        keyword: debouncedSearch || undefined,
    })

    const deleteMutation = conversations.useDelete({
        onSuccess: (_, convId) => {
            removeSettings(convId)
            queryClient.removeQueries({ queryKey: conversations.keys.one(convId) })
            if (activeId === convId) router.replace("/playground/chat")
            toast.success("Conversation deleted")
        },
        onError: () => toast.error("Failed to delete conversation"),
    })

    const renameMutation = conversations.useUpdate({
        onError: () => toast.error("Failed to rename conversation"),
    })

    React.useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
                    fetchNextPage()
                }
            },
            { threshold: 0.1 }
        )
        const target = observerTarget.current
        if (target) observer.observe(target)
        return () => observer.disconnect()
    }, [hasNextPage, fetchNextPage, isFetchingNextPage])

    const convList = React.useMemo(() => {
        const items = data?.pages.flatMap((page) => page?.items || []) || []
        const seen = new Set<string>()
        return items.filter((conv) => {
            if (seen.has(conv.id)) return false
            seen.add(conv.id)
            return true
        })
    }, [data?.pages])

    const groups = React.useMemo(() => groupByUpdatedAt(convList), [convList])

    const handleOpen = React.useCallback(
        (conv: ConversationDTO) => {
            if (activeId === conv.id) return
            router.push(`/playground/chat?c=${encodeURIComponent(conv.id)}`)
        },
        [router, activeId]
    )

    const handleNewChat = React.useCallback(() => {
        if (activeId) router.push("/playground/chat")
    }, [router, activeId])

    const handleRename = React.useCallback(
        (id: string, newTitle: string) => renameMutation.mutate({ id, data: { title: newTitle } }),
        [renameMutation]
    )

    if (!isOpen) {
        return (
            <div className="flex h-full w-11 flex-col items-center border-r bg-background py-2 shrink-0">
                <TooltipProvider delayDuration={300}>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={toggleSidebar}
                                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                            >
                                <PanelLeft className="h-4 w-4" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent side="right">Show history</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => router.push("/playground/chat")}
                                className="h-8 w-8 mt-1 text-muted-foreground hover:text-foreground"
                            >
                                <SquarePen className="h-4 w-4" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent side="right">New chat</TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            </div>
        )
    }

    const trimmedSearch = debouncedSearch
    const showEmpty = !isLoading && convList.length === 0

    return (
        <>
            <div className="flex h-full w-72 flex-col border-r bg-background shrink-0">
                {/* Header: search + new + collapse */}
                <div className="flex items-center gap-1.5 border-b px-2 py-2 shrink-0">
                    <div className="relative flex-1 min-w-0">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/70 pointer-events-none" />
                        <input
                            type="text"
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            placeholder="Search chats"
                            className={cn(
                                "h-8 w-full rounded-md border bg-background pl-7 pr-7 text-sm",
                                "placeholder:text-muted-foreground/60",
                                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:border-ring"
                            )}
                        />
                        {searchInput && (
                            <button
                                type="button"
                                onClick={() => setSearchInput("")}
                                className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-muted text-muted-foreground"
                                title="Clear search"
                            >
                                <X className="h-3.5 w-3.5" />
                            </button>
                        )}
                    </div>
                    <TooltipProvider delayDuration={300}>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={handleNewChat}
                                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                                    disabled={!activeId}
                                >
                                    <SquarePen className="h-4 w-4" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom">New chat</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={toggleSidebar}
                                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                                >
                                    <PanelLeftClose className="h-4 w-4" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom">Collapse</TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>

                {/* List */}
                <div className="flex-1 overflow-y-auto">
                    {isLoading ? (
                        <ListSkeleton />
                    ) : showEmpty ? (
                        <div className="px-3 py-12 text-center">
                            <MessageSquare className="h-8 w-8 mx-auto mb-3 text-muted-foreground/30" />
                            {trimmedSearch ? (
                                <>
                                    <p className="text-sm text-muted-foreground">No matches</p>
                                    <p className="text-xs text-muted-foreground/70 mt-1">
                                        No chats match &ldquo;{trimmedSearch}&rdquo;
                                    </p>
                                </>
                            ) : (
                                <>
                                    <p className="text-sm text-muted-foreground">No conversations</p>
                                    <p className="text-xs text-muted-foreground/70 mt-1">
                                        <button
                                            type="button"
                                            onClick={() => router.push("/playground/chat")}
                                            className="text-primary hover:underline"
                                        >
                                            Start a new chat
                                        </button>{" "}
                                        to see it here
                                    </p>
                                </>
                            )}
                        </div>
                    ) : (
                        <div className="px-2 py-2 space-y-3">
                            {groups.map((group) => (
                                <div key={group.key}>
                                    <div className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                                        {group.label}
                                    </div>
                                    <div className="space-y-0.5">
                                        {group.items.map((conv) => (
                                            <ConversationItem
                                                key={conv.id}
                                                conv={conv}
                                                isSelected={activeId === conv.id}
                                                onOpen={() => handleOpen(conv)}
                                                onDeleteRequest={() => setPendingDelete(conv)}
                                                onRename={(t) => handleRename(conv.id, t)}
                                            />
                                        ))}
                                    </div>
                                </div>
                            ))}
                            <div ref={observerTarget} className="h-6 flex justify-center items-center">
                                {isFetchingNextPage && (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <ConfirmDialog
                open={!!pendingDelete}
                onOpenChange={(open) => !open && setPendingDelete(null)}
                title="Delete conversation"
                description={
                    pendingDelete
                        ? `"${pendingDelete.title}" and all its messages will be removed. This cannot be undone.`
                        : ""
                }
                confirmLabel="Delete"
                destructive
                isLoading={deleteMutation.isPending}
                onConfirm={() => {
                    if (pendingDelete) deleteMutation.mutate(pendingDelete.id)
                    setPendingDelete(null)
                }}
            />
        </>
    )
}
