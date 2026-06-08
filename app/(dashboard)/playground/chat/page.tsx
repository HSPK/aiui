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

    // No ?c= → mint a fresh id up-front so the chat surface renders
    // immediately. The backend creates the conversation row on first
    // message (usePaginatedMessages already 404-tolerates the empty
    // case). We `replace` the URL so the back button doesn't get stuck
    // on the empty state and refresh keeps the same conversation.
    const [draftId] = React.useState(() => urlConvId ?? crypto.randomUUID())
    const conversationId = urlConvId ?? draftId

    React.useEffect(() => {
        if (!urlConvId) {
            router.replace(`/playground/chat?c=${conversationId}`)
        }
    }, [urlConvId, conversationId, router])

    return (
        <div className="h-full flex overflow-hidden bg-background">
            <ConversationSidebar />
            <div className="flex-1 flex flex-col overflow-hidden">
                <MemoizedChatFlow key={conversationId} conversationId={conversationId} />
            </div>
        </div>
    )
}

