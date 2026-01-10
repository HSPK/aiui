"use client"

import * as React from "react"
import { useInfiniteQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { formatToLocal } from "@/lib/utils"
import { MessageSquare, ArrowRight, Clock, Loader2 } from "lucide-react"

interface RecentActivityProps {
    onOpenConversation: (conv: any) => void
}

export function RecentActivity({ onOpenConversation }: RecentActivityProps) {
    const observerTarget = React.useRef<HTMLDivElement>(null)
    const scrollContainerRef = React.useRef<HTMLDivElement>(null)

    const {
        data,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
        isLoading,
    } = useInfiniteQuery({
        queryKey: ["conversations", "recent-home"],
        initialPageParam: 1,
        queryFn: ({ pageParam = 1 }) => api.getConversations(pageParam, 15),
        getNextPageParam: (lastPage) => {
            if (!lastPage) return undefined
            const hasMore = lastPage.page * lastPage.page_size < lastPage.total
            return hasMore ? lastPage.page + 1 : undefined
        },
    })

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

    // Deduplicate conversations by id (can happen with pagination + new data)
    const conversations = React.useMemo(() => {
        const items = data?.pages.flatMap((page) => page?.items || []) || []
        const seen = new Set<string>()
        return items.filter((conv: any) => {
            if (seen.has(conv.id)) return false
            seen.add(conv.id)
            return true
        })
    }, [data?.pages])

    return (
        <div className="flex-1 lg:flex-[2] flex flex-col lg:border-l lg:pl-8 pt-6 lg:pt-0 border-t lg:border-t-0 mt-4 lg:mt-0 min-h-0 overflow-hidden">
            <div className="flex items-center gap-2 mb-3 text-sm font-medium text-muted-foreground shrink-0">
                <Clock className="h-4 w-4" />
                <span>Recent Activity</span>
            </div>

            <div
                ref={scrollContainerRef}
                className="flex-1 overflow-y-auto scrollbar-none min-h-0"
            >
                <div className="space-y-1">
                    {isLoading ? (
                        <div className="flex justify-center py-8">
                            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                        </div>
                    ) : conversations.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
                            <Clock className="h-8 w-8 mb-2 opacity-20" />
                            <p className="text-sm">No recent conversations</p>
                            <p className="text-xs mt-1">Start a new chat to see it here</p>
                        </div>
                    ) : (
                        <>
                            {conversations.map((conv: any) => (
                                <div
                                    key={conv.id}
                                    onClick={() => onOpenConversation(conv)}
                                    className="group flex items-center gap-3 p-2.5 rounded-lg hover:bg-muted/50 cursor-pointer transition-all"
                                >
                                    <div className="w-8 h-8 rounded-lg bg-muted/50 flex items-center justify-center shrink-0">
                                        <MessageSquare className="h-4 w-4 text-muted-foreground" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <span className="font-medium text-sm line-clamp-1 group-hover:text-primary transition-colors">
                                            {conv.title}
                                        </span>
                                        <span className="text-xs text-muted-foreground">
                                            {formatToLocal(conv.updated_at)}
                                        </span>
                                    </div>
                                    <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                                </div>
                            ))}

                            {/* Loading indicator for infinite scroll */}
                            <div ref={observerTarget} className="h-8 flex justify-center items-center">
                                {isFetchingNextPage && (
                                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                )}
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    )
}
