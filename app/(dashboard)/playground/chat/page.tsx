"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"

import { ChatFlow } from "@/components/playground/chat-flow"
import { ConversationSidebar } from "@/components/playground/conversation-sidebar"

const MemoizedChatFlow = React.memo(ChatFlow)

export default function ChatPlaygroundPage() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const urlConvId = searchParams?.get("c") ?? null

    // Route-driven id: when the user lands here with no ?c= (fresh
    // visit OR sidebar "New chat" click), we redirect to a freshly
    // minted conversation id. The replace bumps `urlConvId` and the
    // next render mounts ChatFlow with a stable key — no draft state,
    // no setState-in-effect.
    React.useEffect(() => {
        if (!urlConvId) {
            router.replace(`/playground/chat?c=${crypto.randomUUID()}`)
        }
    }, [urlConvId, router])

    return (
        <div className="h-full flex overflow-hidden bg-background">
            <ConversationSidebar />
            <div className="flex-1 flex flex-col overflow-hidden">
                {urlConvId && (
                    <MemoizedChatFlow key={urlConvId} conversationId={urlConvId} />
                )}
            </div>
        </div>
    )
}

