"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { MessageSquare, Plus, Sparkles } from "lucide-react"

import { ChatFlow } from "@/components/playground/chat-flow"
import { ConversationSidebar } from "@/components/playground/conversation-sidebar"
import { Button } from "@/components/ui/button"

const MemoizedChatFlow = React.memo(ChatFlow)

function ChatEmpty() {
    const router = useRouter()
    const startNew = React.useCallback(() => {
        router.push(`/playground/chat?c=${crypto.randomUUID()}`)
    }, [router])
    return (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500/20 to-cyan-500/20">
                <MessageSquare className="h-6 w-6 text-blue-500" />
            </div>
            <div className="space-y-1">
                <h2 className="text-lg font-semibold tracking-tight">Start a chat</h2>
                <p className="text-sm text-muted-foreground max-w-xs">
                    Pick a model, ask anything. Compare across providers in the same thread.
                </p>
            </div>
            <Button onClick={startNew} size="sm" className="mt-1">
                <Plus className="h-4 w-4 mr-1.5" />
                New chat
            </Button>
            <p className="text-[11px] text-muted-foreground mt-1 inline-flex items-center gap-1">
                <Sparkles className="h-3 w-3" />
                Or pick a past conversation from the sidebar
            </p>
        </div>
    )
}

export default function ChatPlaygroundPage() {
    const searchParams = useSearchParams()
    const conversationId = searchParams?.get("c") ?? null

    return (
        <div className="h-full flex overflow-hidden bg-background">
            <ConversationSidebar />
            <div className="flex-1 flex flex-col overflow-hidden">
                {conversationId ? (
                    <MemoizedChatFlow key={conversationId} conversationId={conversationId} />
                ) : (
                    <ChatEmpty />
                )}
            </div>
        </div>
    )
}
