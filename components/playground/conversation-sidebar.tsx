"use client"

import { useQueryClient } from "@tanstack/react-query"
import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"
import {
    Loader2,
    MessageSquare,
    PanelLeftClose,
    PanelLeft,
    Search,
    SquarePen,
    X,
} from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { conversations } from "@/lib/api/conversations"
import { ApiError } from "@/lib/api/client"
import { transformMessage } from "@/components/playground/hooks/use-paginated-messages"
import type { ConversationDTO } from "@/lib/schemas/conversation"
import { usePlaygroundStore } from "@/lib/stores/playground-store"
import { useModalityStore } from "@/lib/stores/modality-store"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent } from "@/components/ui/sheet"
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { ConversationItem, ListSkeleton } from "./_parts/conversation-item"

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


// ---------- main ----------

export function ConversationSidebar() {
    const router = useRouter()
    // Note: navigation is via router.push() (SPA soft nav). The page
    // no longer does an auto-mint router.replace() on mount, which
    // historically blocked sidebar pushes by leaving a perpetually-
    // pending transition (v1.4.4 bug). New drafts are minted client-
    // side via useState in the page; no programmatic URL update
    // happens until the user sends the first message.
    const searchParams = useSearchParams()
    const activeId = searchParams?.get("c") ?? null

    const isOpen = usePlaygroundStore((s) => s.isHistorySidebarOpen)
    const toggleSidebar = usePlaygroundStore((s) => s.toggleHistorySidebar)
    const removeSettings = usePlaygroundStore((s) => s.removeSettings)
    const queryClient = useQueryClient()

    const [searchInput, setSearchInput] = React.useState("")
    const [debouncedSearch, setDebouncedSearch] = React.useState("")
    const mobileSheetOpen = useModalityStore((s) => s.chatHistoryOpen)
    const setMobileSheetOpen = useModalityStore((s) => s.setChatHistoryOpen)
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
            // Use ?fresh= to force a new draft mint even though we're
            // replacing into the bare /playground/chat path (the page's
            // auto-mint effect reacts to the freshToken change).
            if (activeId === convId && typeof window !== "undefined") {
                window.location.assign(`/playground/chat?fresh=${Date.now()}`)
            }
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

    // Programmatic "go to a fresh draft". Bare router.push to
    // /playground/chat — the page's draft re-mint logic kicks in on
    // urlConvId real→null transition. When already on a draft, this
    // is technically a no-op for Next.js (same URL) so we use the
    // `_=<ts>` cache-buster to force a render-cycle the page can
    // react to. Soft-nav fallback at the bottom catches deployments
    // where Next.js's router stalls.
    const handleNewChat = React.useCallback(() => {
        const href = activeId == null
            ? `/playground/chat?_=${Date.now()}`
            : "/playground/chat"
        router.push(href)
        setTimeout(() => {
            if (typeof window === "undefined") return
            // Successful soft-nav if the URL no longer has ?c=
            if (!window.location.search.includes("c=")) return
            window.location.assign(href)
        }, 300)
    }, [router, activeId])

    const handleRename = React.useCallback(
        (conv: ConversationDTO, newTitle: string) =>
            renameMutation.mutate({ id: conv.id, data: { title: newTitle } }),
        [renameMutation]
    )

    const handleDeleteRequest = React.useCallback((conv: ConversationDTO) => {
        setPendingDelete(conv)
    }, [])

    // Mobile sheet close hook — fires alongside the link's navigation.
    const handlePickedMobile = React.useCallback(
        () => setMobileSheetOpen(false),
        [setMobileSheetOpen],
    )

    // Hover prefetch — warm the messages cache on mouse-enter so the
    // click feels instant (no fetch round-trip while the user waits
    // for the new chat surface to populate). React Query dedupes the
    // request to the EXACT same key the chat surface will hit, so on
    // click usePaginatedMessages reads cached data + skips the fetch
    // entirely. We track which ids we've already prefetched in a
    // module-lifetime Set to avoid duplicate work for users who hover
    // the same row repeatedly.
    const prefetchedRef = React.useRef<Set<string>>(new Set())
    const handleHoverPrefetch = React.useCallback((conv: ConversationDTO) => {
        if (prefetchedRef.current.has(conv.id)) return
        prefetchedRef.current.add(conv.id)
        void queryClient.prefetchQuery({
            queryKey: conversations.messagesCacheKey(conv.id, 20),
            queryFn: async () => {
                try {
                    const res = await conversations.listMessages(conv.id, {
                        page: 1,
                        page_size: 20,
                        sort: "-created_at",
                    })
                    return res.items.slice().reverse().map(transformMessage)
                } catch (e) {
                    if (e instanceof ApiError && e.status === 404) return []
                    throw e
                }
            },
            staleTime: 5 * 60 * 1000,
        })
    }, [queryClient])

    const trimmedSearch = debouncedSearch
    const showEmpty = !isLoading && convList.length === 0

    // Shared body: search + new + collapse header + scrollable list.
    // Used by both the desktop inline sidebar and the mobile Sheet so
    // styling stays in lock-step and there's a single source of truth.
    // Plain render function (NOT a React component) — defining a
    // closure-captured component inside the parent would mount a new
    // identity on every parent render, throwing away its subtree state.
    function renderBody({ onItemPick, compact }: { onItemPick?: () => void; compact: boolean }) {
        // Mobile sheet passes a closer via `onItemPick`; desktop just
        // lets the Link's native nav handle the click.
        const onPick = onItemPick ? handlePickedMobile : undefined
        return (
        <>
            <div className={cn(
                "flex items-center gap-1 border-b shrink-0",
                compact ? "px-2 h-10" : "px-3 h-14",
            )}>
                <div className="relative flex-1 min-w-0">
                    <Search className={cn(
                        "absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground/70 pointer-events-none",
                        compact ? "h-3.5 w-3.5" : "h-4 w-4",
                    )} />
                    <input
                        type="text"
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                        placeholder="Search chats"
                        className={cn(
                            "w-full rounded-md border bg-background pl-7 pr-7",
                            "placeholder:text-muted-foreground/60",
                            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:border-ring",
                            compact ? "h-7 text-xs" : "h-10 text-sm",
                        )}
                    />
                    {searchInput && (
                        <button
                            type="button"
                            onClick={() => setSearchInput("")}
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-muted text-muted-foreground"
                            title="Clear search"
                        >
                            <X className={compact ? "h-3 w-3" : "h-4 w-4"} />
                        </button>
                    )}
                </div>
                <TooltipProvider delayDuration={300}>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => {
                                    handleNewChat()
                                    onItemPick?.()
                                }}
                                className={cn(
                                    "shrink-0 text-muted-foreground hover:text-foreground",
                                    compact ? "h-7 w-7" : "h-10 w-10",
                                )}
                                disabled={!activeId}
                                aria-label="New chat"
                            >
                                <SquarePen className={compact ? "h-3.5 w-3.5" : "h-5 w-5"} />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">New chat</TooltipContent>
                    </Tooltip>
                    {compact && (
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={toggleSidebar}
                                    aria-label="Collapse sidebar"
                                    className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
                                >
                                    <PanelLeftClose className="h-3.5 w-3.5" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom">Collapse</TooltipContent>
                        </Tooltip>
                    )}
                </TooltipProvider>
            </div>

            <div className="flex-1 overflow-y-auto">
                {isLoading ? (
                    <ListSkeleton />
                ) : showEmpty ? (
                    <div className={compact ? "px-3 py-12 text-center" : "px-4 py-16 text-center"}>
                        <MessageSquare className={cn(
                            "mx-auto mb-3 text-muted-foreground/30",
                            compact ? "h-8 w-8" : "h-10 w-10",
                        )} />
                        {trimmedSearch ? (
                            <>
                                <p className={cn("text-muted-foreground mb-1", compact ? "text-sm" : "text-base")}>
                                    No matches
                                </p>
                                <p className={cn("text-muted-foreground/70", compact ? "text-xs" : "text-sm")}>
                                    Try a different search term
                                </p>
                            </>
                        ) : (
                            <>
                                <p className={cn("text-muted-foreground mb-1", compact ? "text-sm" : "text-base")}>
                                    No conversations yet
                                </p>
                                <p className={cn("text-muted-foreground/70", compact ? "text-xs" : "text-sm")}>
                                    Start a new chat to see it here
                                </p>
                            </>
                        )}
                    </div>
                ) : (
                    <div className={compact ? "px-2 py-2 space-y-3" : "px-3 py-3 space-y-4"}>
                        {groups.map((group) => (
                            <div key={group.key}>
                                <div className={cn(
                                    "pb-1 font-semibold uppercase tracking-wider text-muted-foreground/60",
                                    compact ? "px-2 text-[10px]" : "px-3 text-[11px]",
                                )}>
                                    {group.label}
                                </div>
                                <div className="space-y-0.5">
                                    {group.items.map((conv) => (
                                        <ConversationItem
                                            key={conv.id}
                                            conv={conv}
                                            isSelected={activeId === conv.id}
                                            href={`/playground/chat?c=${encodeURIComponent(conv.id)}`}
                                            onPick={onPick}
                                            onHoverPrefetch={handleHoverPrefetch}
                                            onDeleteRequest={handleDeleteRequest}
                                            onRename={handleRename}
                                            compact={compact}
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
        </>
        )
    }

    return (
        <>
            {/* Desktop: inline sidebar, w-72 or w-10 collapsed rail */}
            {isOpen ? (
                <div className="hidden md:flex h-full w-72 flex-col border-r bg-background shrink-0">
                    {renderBody({ compact: true })}
                </div>
            ) : (
                <div className="hidden md:flex h-full w-10 flex-col items-center border-r bg-background py-1 shrink-0">
                    <TooltipProvider delayDuration={300}>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={toggleSidebar}
                                    aria-label="Show chat history"
                                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                >
                                    <PanelLeft className="h-3.5 w-3.5" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="right">Show history</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={handleNewChat}
                                    aria-label="New chat"
                                    className="h-7 w-7 mt-0.5 text-muted-foreground hover:text-foreground"
                                >
                                    <SquarePen className="h-3.5 w-3.5" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="right">New chat</TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>
            )}

            {/* Mobile: Sheet with bigger touch targets. The trigger
             *  lives in the topbar (rendered contextually when on the
             *  chat page) — a floating button on top of the messages
             *  felt visually out of place. Sheet open state lives in
             *  the modality store so the topbar can flip it. */}
            <Sheet open={mobileSheetOpen} onOpenChange={setMobileSheetOpen}>
                <SheetContent
                    side="left"
                    hideClose
                    className="w-80 max-w-[85vw] p-0 flex flex-col"
                    // Radix auto-focuses the first focusable element on
                    // open — for this sheet that's the search input,
                    // which immediately pops the virtual keyboard on
                    // mobile (covers half the conversation list the
                    // user opened the sheet to see). Suppress; the
                    // user can tap search if they want to type.
                    onOpenAutoFocus={(e) => e.preventDefault()}
                >
                    {renderBody({ compact: false, onItemPick: () => setMobileSheetOpen(false) })}
                </SheetContent>
            </Sheet>

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
