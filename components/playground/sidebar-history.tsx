"use client"

import * as React from "react"
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import { Loader2, MessageSquare, MoreHorizontal, Pencil, Trash2, Check, X } from "lucide-react"
import { usePlaygroundStore } from "@/lib/stores/playground-store"
import { Conversation } from "@/lib/types/playground"
import { useRouter, usePathname } from "next/navigation"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { toast } from "sonner"

function ConversationItem({
    conv,
    isSelected,
    onOpen,
    onDelete,
    onRename,
}: {
    conv: Conversation
    isSelected: boolean
    onOpen: () => void
    onDelete: () => void
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
        const trimmedTitle = editTitle.trim()
        if (trimmedTitle && trimmedTitle !== conv.title) {
            onRename(trimmedTitle)
        }
        setIsEditing(false)
    }

    const handleCancelEdit = () => {
        setEditTitle(conv.title)
        setIsEditing(false)
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !isComposingRef.current) {
            handleSaveEdit()
        } else if (e.key === "Escape") {
            handleCancelEdit()
        }
    }

    const handleCompositionStart = () => {
        isComposingRef.current = true
    }

    const handleCompositionEnd = () => {
        isComposingRef.current = false
    }

    const handleDelete = (e: React.MouseEvent) => {
        e.stopPropagation()
        setDropdownOpen(false)
        onDelete()
    }

    if (isEditing) {
        return (
            <div className="flex items-center gap-1.5 rounded-md px-2.5 py-1 relative">
                <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
                <input
                    ref={inputRef}
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onCompositionStart={handleCompositionStart}
                    onCompositionEnd={handleCompositionEnd}
                    onBlur={handleSaveEdit}
                    className="flex-1 bg-transparent text-xs outline-none border-b border-primary/50 py-0.5"
                    onClick={(e) => e.stopPropagation()}
                />
                <button
                    onClick={(e) => {
                        e.stopPropagation()
                        handleSaveEdit()
                    }}
                    className="p-0.5 hover:bg-green-500/10 rounded text-green-600 shrink-0"
                >
                    <Check className="h-3 w-3" />
                </button>
                <button
                    onClick={(e) => {
                        e.stopPropagation()
                        handleCancelEdit()
                    }}
                    className="p-0.5 hover:bg-red-500/10 rounded text-red-600 shrink-0"
                >
                    <X className="h-3 w-3" />
                </button>
            </div>
        )
    }

    return (
        <div
            onClick={onOpen}
            className={cn(
                "group flex items-center gap-2 rounded-md px-4 py-1.5 text-xs cursor-pointer transition-all relative",
                isSelected
                    ? "bg-secondary text-secondary-foreground font-medium"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            )}
        >
            <MessageSquare className={cn(
                "h-3.5 w-3.5 shrink-0",
                isSelected ? "text-secondary-foreground" : "text-muted-foreground/70"
            )} />
            <span className="truncate flex-1">{conv.title}</span>

            {/* Dropdown menu - visible on hover */}
            <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
                <DropdownMenuTrigger asChild>
                    <button
                        onClick={(e) => e.stopPropagation()}
                        className={cn(
                            "p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 transition-opacity shrink-0",
                            dropdownOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                        )}
                    >
                        <MoreHorizontal className="h-3.5 w-3.5" />
                    </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-32">
                    <DropdownMenuItem onClick={handleStartEdit} className="text-xs">
                        <Pencil className="h-3.5 w-3.5 mr-2" />
                        Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        onClick={handleDelete}
                        className="text-xs text-destructive focus:text-destructive"
                    >
                        <Trash2 className="h-3.5 w-3.5 mr-2" />
                        Delete
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    )
}

export function SidebarHistory() {
    const { addTab, setActiveTab, tabs, activeTabId, removeTab, updateTabTitle } = usePlaygroundStore()
    const router = useRouter()
    const pathname = usePathname()
    const queryClient = useQueryClient()
    const observerTarget = React.useRef<HTMLDivElement>(null)
    const scrollContainerRef = React.useRef<HTMLDivElement>(null)

    const {
        data,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
        isLoading,
    } = useInfiniteQuery({
        queryKey: ["conversations", "sidebar"],
        initialPageParam: 1,
        queryFn: ({ pageParam = 1 }) => api.getConversations(pageParam, 10),
        getNextPageParam: (lastPage) => {
            if (!lastPage) return undefined
            const hasMore = lastPage.page * lastPage.page_size < lastPage.total
            return hasMore ? lastPage.page + 1 : undefined
        },
    })

    // Delete mutation
    const deleteMutation = useMutation({
        mutationFn: (convId: string) => api.deleteConversation(convId),
        onSuccess: (_, convId) => {
            // Close any tab with this conversation
            const tabToRemove = tabs.find(t => t.conversationId === convId)
            if (tabToRemove) {
                removeTab(tabToRemove.id)
            }
            // Invalidate queries
            queryClient.invalidateQueries({ queryKey: ["conversations"] })
            toast.success("Conversation deleted")
        },
        onError: () => {
            toast.error("Failed to delete conversation")
        },
    })

    // Rename mutation
    const renameMutation = useMutation({
        mutationFn: ({ convId, title }: { convId: string; title: string }) =>
            api.updateConversationTitle(convId, title),
        onSuccess: (_, { convId, title }) => {
            // Update tab title if open
            const tabToUpdate = tabs.find(t => t.conversationId === convId)
            if (tabToUpdate) {
                updateTabTitle(tabToUpdate.id, title)
            }
            // Invalidate queries
            queryClient.invalidateQueries({ queryKey: ["conversations"] })
            toast.success("Conversation renamed")
        },
        onError: () => {
            toast.error("Failed to rename conversation")
        },
    })

    // Get active conversation ID from active tab
    const activeConversationId = React.useMemo(() => {
        const activeTab = tabs.find(t => t.id === activeTabId)
        return activeTab?.conversationId
    }, [tabs, activeTabId])

    const handleOpenConversation = (conv: Conversation) => {
        const existingTab = tabs.find(t => t.conversationId === conv.id)
        if (existingTab) {
            setActiveTab(existingTab.id)
        } else {
            addTab({
                type: "chat",
                title: conv.title,
                conversationId: conv.id,
            })
        }
        router.push("/chat")
    }

    // Check if a conversation is currently selected
    const isConversationSelected = (convId: string) => {
        return pathname === "/chat" && activeConversationId === convId
    }

    // Intersection Observer for infinite scroll
    React.useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
                    fetchNextPage()
                }
            },
            { threshold: 0.1 }
        )

        if (observerTarget.current) {
            observer.observe(observerTarget.current)
        }

        return () => observer.disconnect()
    }, [hasNextPage, fetchNextPage, isFetchingNextPage])

    if (isLoading) {
        return (
            <div className="flex justify-center py-3">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
        )
    }

    // Deduplicate conversations by id (can happen with pagination + new data)
    const conversations = React.useMemo(() => {
        const items = data?.pages.flatMap((page) => page?.items || []) || []
        const seen = new Set<string>()
        return items.filter(conv => {
            if (seen.has(conv.id)) return false
            seen.add(conv.id)
            return true
        })
    }, [data?.pages])

    if (conversations.length === 0) {
        return (
            <div className="px-4 py-2 text-xs text-muted-foreground/60 italic">
                No conversations yet
            </div>
        )
    }

    return (
        <div
            ref={scrollContainerRef}
            className="max-h-[280px] overflow-y-auto scrollbar-none ml-2 mr-1 my-1"
        >
            <div className="space-y-0.5 pr-1">
                {conversations.map((conv) => (
                    <ConversationItem
                        key={conv.id}
                        conv={conv}
                        isSelected={isConversationSelected(conv.id)}
                        onOpen={() => handleOpenConversation(conv)}
                        onDelete={() => deleteMutation.mutate(conv.id)}
                        onRename={(newTitle) => renameMutation.mutate({ convId: conv.id, title: newTitle })}
                    />
                ))}

                {/* Loading indicator for next page */}
                <div ref={observerTarget} className="h-6 flex justify-center items-center">
                    {isFetchingNextPage && (
                        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                    )}
                </div>
            </div>
        </div>
    )
}
