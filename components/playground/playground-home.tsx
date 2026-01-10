"use client"

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { formatToLocal } from "@/lib/utils"
import { usePlaygroundStore } from "@/lib/stores/playground-store"
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { MessageSquare, Terminal, FileJson, Database, ArrowRight, Clock, Loader2 } from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"

export function PlaygroundHome({ tabId }: { tabId?: string }) {
    const { addTab, updateTab, tabs, setActiveTab } = usePlaygroundStore()

    const { data: historyData, isLoading: historyLoading } = useQuery({
        queryKey: ["conversations", "recent"],
        queryFn: () => api.getConversations(1, 20, ""),
    })

    const handleSelect = (types: any) => {
        if (tabId) {
            updateTab(tabId, { type: types, title: "Chat" });
        } else {
            addTab(types);
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
            description: "Interact with LLMs in a continuous conversation mode. Good for general tasks and testing.",
            icon: MessageSquare,
            action: () => handleSelect("chat"),
            disabled: false
        },
        {
            title: "Prompt Design",
            description: "Iterate on system prompts and variable inputs to optimize specific tasks.",
            icon: Terminal,
            action: () => { },
            disabled: true
        },
        {
            title: "Embedding",
            description: "Visualize and test vector embeddings for semantic search applications.",
            icon: Database,
            action: () => { },
            disabled: true
        },
        {
            title: "Rerank",
            description: "Test reranking models to improve search relevance.",
            icon: FileJson,
            action: () => { },
            disabled: true
        }
    ]

    return (
        <div className="flex-1 flex flex-col p-6 w-full h-full overflow-hidden">
            <div className="flex-1 max-w-7xl w-full mx-auto grid grid-cols-1 lg:grid-cols-5 gap-8 h-full">
                {/* Left Column: Templates (3 cols wide on large screens - 60%) */}
                <div className="lg:col-span-3 flex flex-col space-y-4 overflow-y-auto pr-2">
                    <div className="space-y-1 mt-4">
                        <h2 className="text-2xl font-bold tracking-tight">Playground</h2>
                        <p className="text-muted-foreground text-base">
                            Select a template to start testing and building with your models.
                        </p>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pb-8">
                        {templates.map((template) => (
                            <Card
                                key={template.title}
                                className={`
                                    group relative overflow-hidden transition-all hover:shadow-md cursor-pointer border-muted/60
                                    ${template.disabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-primary/50'}
                                `}
                                onClick={!template.disabled ? template.action : undefined}
                            >
                                <CardHeader className="p-3">
                                    <div className="flex items-start justify-between">
                                        <div className={`
                                            p-1.5 rounded-lg transition-colors
                                            ${template.disabled ? 'bg-muted' : 'bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground'}
                                        `}>
                                            <template.icon className="h-5 w-5" />
                                        </div>
                                        {!template.disabled && (
                                            <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 -translate-x-2 transition-all group-hover:opacity-100 group-hover:translate-x-0" />
                                        )}
                                    </div>
                                    <CardTitle className="mt-2 text-base">{template.title}</CardTitle>
                                    <CardDescription className="mt-1 line-clamp-2 text-xs">
                                        {template.description}
                                    </CardDescription>
                                </CardHeader>
                            </Card>
                        ))}
                    </div>
                </div>

                {/* Right Column: Recent History (2 cols wide - 40%) */}
                <div className="hidden lg:flex lg:col-span-2 flex-col border-l pl-8 h-full overflow-hidden py-6">
                    <div className="flex items-center gap-2 mb-4 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                        <Clock className="h-4 w-4" />
                        <span>Recent Activity</span>
                    </div>

                    <ScrollArea className="flex-1 -mr-4 pr-4">
                        <div className="space-y-2">
                            {historyLoading ? (
                                <div className="flex justify-center py-8">
                                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                                </div>
                            ) : historyData?.items?.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
                                    <Clock className="h-8 w-8 mb-2 opacity-20" />
                                    <p className="text-sm">No recent conversations</p>
                                </div>
                            ) : (
                                historyData?.items?.map((conv: any) => (
                                    <div
                                        key={conv.id}
                                        onClick={() => handleOpenHistory(conv)}
                                        className="group flex flex-col gap-1 p-3 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors border border-transparent hover:border-border/50"
                                    >
                                        <span className="font-medium text-sm line-clamp-1 group-hover:text-primary transition-colors">
                                            {conv.title}
                                        </span>
                                        <span className="text-xs text-muted-foreground">
                                            {formatToLocal(conv.created_at)}
                                        </span>
                                    </div>
                                ))
                            )}
                        </div>
                    </ScrollArea>
                </div>
            </div>
        </div>
    )
}
