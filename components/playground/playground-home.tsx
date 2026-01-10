"use client"

import { usePlaygroundStore, TabType } from "@/lib/stores/playground-store"
import { MessageSquare, Terminal, FileJson, Database, Sparkles } from "lucide-react"
import { TemplateCard, Template } from "./template-card"
import { RecentActivity } from "./recent-activity"

export function PlaygroundHome({ tabId }: { tabId?: string }) {
    const { addTab, updateTab, tabs, setActiveTab } = usePlaygroundStore()

    const handleSelect = (types: TabType) => {
        const conversationId = crypto.randomUUID()
        if (tabId) {
            updateTab(tabId, { type: types, title: "Chat", conversationId })
        } else {
            addTab({ type: types, title: "Chat", conversationId })
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

    const templates: Template[] = [
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

                    {/* Template Grid */}
                    <div className="flex gap-2 overflow-x-auto pb-2 lg:gap-3 lg:flex-wrap scrollbar-none">
                        {templates.map((template) => (
                            <TemplateCard key={template.title} template={template} />
                        ))}
                    </div>
                </div>

                {/* Right Column (Desktop) / Bottom (Mobile): Recent Activity */}
                <RecentActivity onOpenConversation={handleOpenHistory} />
            </div>
        </div>
    )
}
