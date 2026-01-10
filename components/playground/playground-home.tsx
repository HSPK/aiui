"use client"

import * as React from "react"
import { useInfiniteQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { formatToLocal, cn } from "@/lib/utils"
import { usePlaygroundStore } from "@/lib/stores/playground-store"
import { MessageSquare, Terminal, FileJson, Database, ArrowRight, Clock, Loader2, Sparkles } from "lucide-react"

export function PlaygroundHome({ tabId }: { tabId?: string }) {
    const { addTab, updateTab, tabs, setActiveTab } = usePlaygroundStore()
    const observerTarget = React.useRef<HTMLDivElement>(null)
    const scrollContainerRef = React.useRef<HTMLDivElement>(null)

    const {
        data,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
        isLoading: historyLoading,
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

    const conversations = data?.pages.flatMap((page) => page?.items || []) || []

    const handleSelect = (types: any) => {
        const conversationId = crypto.randomUUID()
        if (tabId) {
            updateTab(tabId, { type: types, title: "Chat", conversationId });
        } else {
            addTab({ type: types, title: "Chat", conversationId });
        }
    }

    const handleOpenHistory = (conv: any) => {
        const existingTab = tabs.find(t => t.conversationId === conv.id)
        if (existingTab) {
            setActiveTab(existingTab.id)
            return
        }

        if (tabId) {
            updateTab(tabId, {
                type: "chat",
                title: conv.title,
                conversationId: conv.id
            })
        } else {
            addTab({
                type: "chat",
                title: conv.title,
                conversationId: conv.id
            })
        }
    }

    const templates = [
        {
            title: "Chat Flow",
            description: "Multi-turn conversation with LLMs",
            icon: MessageSquare,
            action: () => handleSelect("chat"),
            disabled: false,
            gradient: "from-blue-500/20 to-cyan-500/20",
            iconColor: "text-blue-500"
        },
        {
            title: "Prompt Design",
            description: "Optimize prompts with variables",
            icon: Terminal,
            action: () => { },
            disabled: true,
            gradient: "from-purple-500/20 to-pink-500/20",
            iconColor: "text-purple-500"
        },
        {
            title: "Embedding",
            description: "Test vector embeddings",
            icon: Database,
            action: () => { },
            disabled: true,
            gradient: "from-green-500/20 to-emerald-500/20",
            iconColor: "text-green-500"
        },
        {
            title: "Rerank",
            description: "Improve search relevance",
            icon: FileJson,
            action: () => { },
            disabled: true,
            gradient: "from-orange-500/20 to-amber-500/20",
            iconColor: "text-orange-500"
        }
    ]

    return (
        <div className="flex-1 flex flex-col w-full h-full overflow-hidden">
            <div className="flex-1 max-w-6xl w-full mx-auto p-6 flex flex-col lg:flex-row gap-8 h-full overflow-hidden">
                {/* Left Column: Templates */}
                <div className="flex-none lg:flex-[3] flex flex-col space-y-4">
                    <div className="space-y-1">
                        <div className="flex items-center gap-2">
                            <Sparkles className="h-5 w-5 text-primary" />
                            <h2 className="text-xl font-semibold">Start New</h2>
                        </div>
                        <p className="text-muted-foreground text-sm">
                            Choose a template to begin
                        </p>
                    </div>

                    {/* Template Grid - Compact horizontal layout */}
                    <div className="flex gap-2 overflow-x-auto pb-2 lg:flex-wrap scrollbar-none">
                        {templates.map((template) => (
                            <div
                                key={template.title}
                                onClick={!template.disabled ? template.action : undefined}
                                className={cn(
                                    "group relative flex-shrink-0 rounded-xl border px-3 py-2.5 transition-all duration-200",
                                    template.disabled 
                                        ? "opacity-50 cursor-not-allowed bg-muted/30" 
                                        : "cursor-pointer hover:shadow-md hover:border-primary/50 bg-gradient-to-br " + template.gradient
                                )}
                            >
                                <div className="flex items-center gap-3">
                                    <div className={cn(
                                        "w-9 h-9 rounded-lg flex items-center justify-center shrink-0",
                                        template.disabled ? "bg-muted" : "bg-background/80 backdrop-blur-sm shadow-sm"
                                    )}>
                                        <template.icon className={cn(
                                            "h-4 w-4",
                                            template.disabled ? "text-muted-foreground" : template.iconColor
                                        )} />
                                    </div>
                                    <div className="min-w-0">
                                        <h3 className="font-medium text-sm flex items-center gap-1.5 whitespace-nowrap">
                                            {template.title}
                                            {template.disabled && (
                                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                                                    Soon
                                                </span>
                                            )}
                                            {!template.disabled && (
                                                <ArrowRight className="h-3 w-3 opacity-0 -translate-x-1 transition-all group-hover:opacity-100 group-hover:translate-x-0" />
                                            )}
                                        </h3>
                                        <p className="text-xs text-muted-foreground line-clamp-1 hidden lg:block">
                                            {template.description}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Right Column (Desktop) / Bottom (Mobile): Recent Activity */}
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
                            {historyLoading ? (
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
                                            onClick={() => handleOpenHistory(conv)}
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
                                                    {formatToLocal(conv.created_at)}
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
            </div>
        </div>
    )
}
