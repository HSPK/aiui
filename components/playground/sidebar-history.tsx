"use client"

import * as React from "react"
import { useInfiniteQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import { Loader2, MessageSquare } from "lucide-react"
import { usePlaygroundStore } from "@/lib/stores/playground-store"
import { Conversation } from "@/lib/types/playground"
import { useRouter } from "next/navigation"

export function SidebarHistory() {
    const { addTab, setActiveTab, tabs } = usePlaygroundStore()
    const router = useRouter()
    const observerTarget = React.useRef<HTMLDivElement>(null)

    const {
        data,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
        isLoading,
    } = useInfiniteQuery({
        queryKey: ["conversations", "sidebar"],
        initialPageParam: 1,
        queryFn: ({ pageParam = 1 }) => api.getConversations(pageParam, 10), // Fetch 10 at a time
        getNextPageParam: (lastPage) => {
            if (!lastPage) return undefined
            const hasMore = lastPage.page * lastPage.page_size < lastPage.total
            return hasMore ? lastPage.page + 1 : undefined
        },
    })

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

    // Intersection Observer for infinite scroll
    React.useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting && hasNextPage) {
                    fetchNextPage()
                }
            },
            { threshold: 0.1 }
        )

        if (observerTarget.current) {
            observer.observe(observerTarget.current)
        }

        return () => observer.disconnect()
    }, [hasNextPage, fetchNextPage])

    if (isLoading) {
        return (
            <div className="flex justify-center p-4">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
        )
    }

    const conversations = data?.pages.flatMap((page) => page?.items || []) || []

    if (conversations.length === 0) {
        return null
    }

    return (
        <div className="pl-4 pr-2 py-1 space-y-0.5">
            {conversations.map((conv) => (
                <div
                    key={conv.id}
                    onClick={() => handleOpenConversation(conv)}
                    className={cn(
                        "group flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground cursor-pointer transition-colors max-w-full"
                    )}
                >
                    <MessageSquare className="h-3 w-3 shrink-0" />
                    <span className="truncate flex-1">{conv.title}</span>
                </div>
            ))}

            {/* Loading indicator for next page */}
            <div ref={observerTarget} className="h-4 flex justify-center w-full">
                {isFetchingNextPage && (
                    <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                )}
            </div>
        </div>
    )
}
