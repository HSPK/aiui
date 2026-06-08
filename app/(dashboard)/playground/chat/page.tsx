"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"

import { ChatFlow } from "@/components/playground/chat-flow"
import { ConversationSidebar } from "@/components/playground/conversation-sidebar"
import { conversations } from "@/lib/api"
import type { Message } from "@/components/playground/chat/types"

const INITIAL_PAGE_SIZE = 20
const MemoizedChatFlow = React.memo(ChatFlow)

export default function ChatPlaygroundPage() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const queryClient = useQueryClient()
    const urlConvId = searchParams?.get("c") ?? null

    // Route-driven id: when the user lands here with no ?c= (fresh
    // visit OR sidebar "New chat" click), we redirect to a freshly
    // minted conversation id. The replace bumps `urlConvId` and the
    // next render mounts ChatFlow with a stable key — no draft state,
    // no setState-in-effect.
    //
    // Pre-seed the messages cache for the new id so usePaginatedMessages
    // sees `data = []` immediately on first render. Without this, the
    // query fires a /messages?page=1 round-trip that 404s (the server
    // creates the row on first send), and the chat surface shows a
    // "Loading conversation…" spinner for the 100-500ms RTT — useless
    // chrome for a brand-new chat that we already know is empty.
    React.useEffect(() => {
        if (urlConvId) return
        const fresh = crypto.randomUUID()
        queryClient.setQueryData<Message[]>(
            conversations.messagesCacheKey(fresh, INITIAL_PAGE_SIZE),
            [],
        )
        router.replace(`/playground/chat?c=${fresh}`)
    }, [urlConvId, router, queryClient])

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

