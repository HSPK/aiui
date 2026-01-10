"use client"

import * as React from "react"
import { usePlaygroundStore } from "@/lib/stores/playground-store"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { MessageSquare, Terminal, FileJson, Database, ArrowRight } from "lucide-react"

export function PlaygroundHome({ tabId }: { tabId?: string }) {
    const { addTab, updateTab } = usePlaygroundStore()

    const handleSelect = (types: any) => { // Using explicit type map would be better
        if (tabId) {
            updateTab(tabId, { type: types, title: "Chat" });
        } else {
            addTab(types);
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
            action: () => { }, // Placeholder
            disabled: true
        },
        {
            title: "Embedding",
            description: "Visualize and test vector embeddings for semantic search applications.",
            icon: Database,
            action: () => { }, // Placeholder
            disabled: true
        },
        {
            title: "Rerank",
            description: "Test reranking models to improve search relevance.",
            icon: FileJson,
            action: () => { }, // Placeholder
            disabled: true
        }
    ]

    return (
        <div className="flex-1 flex flex-col items-center justify-center p-8 overflow-y-auto w-full">
            <div className="max-w-4xl w-full space-y-8">
                <div className="space-y-2 text-center sm:text-left">
                    <h2 className="text-3xl font-bold tracking-tight">Playground</h2>
                    <p className="text-muted-foreground text-lg">
                        Select a template to start testing and building with your models.
                    </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {templates.map((template) => (
                        <Card
                            key={template.title}
                            className={`
                                group relative overflow-hidden transition-all hover:shadow-md cursor-pointer border-muted/60
                                ${template.disabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-primary/50'}
                            `}
                            onClick={!template.disabled ? template.action : undefined}
                        >
                            <CardHeader className="pb-4">
                                <div className="flex items-start justify-between">
                                    <div className={`
                                        p-2 rounded-lg transition-colors
                                        ${template.disabled ? 'bg-muted' : 'bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground'}
                                    `}>
                                        <template.icon className="h-6 w-6" />
                                    </div>
                                    {!template.disabled && (
                                        <ArrowRight className="h-5 w-5 text-muted-foreground opacity-0 -translate-x-2 transition-all group-hover:opacity-100 group-hover:translate-x-0" />
                                    )}
                                </div>
                                <CardTitle className="mt-4">{template.title}</CardTitle>
                                <CardDescription className="mt-2 line-clamp-2">
                                    {template.description}
                                </CardDescription>
                            </CardHeader>
                        </Card>
                    ))}
                </div>
            </div>
        </div>
    )
}
