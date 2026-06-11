"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"

import { ChatFlow } from "@/components/playground/chat-flow"
import { ConversationSidebar } from "@/components/playground/conversation-sidebar"
import { conversations } from "@/lib/api/conversations"
import type { Message } from "@/components/playground/chat/types"

const INITIAL_PAGE_SIZE = 20
const MemoizedChatFlow = React.memo(ChatFlow)

export default function ChatPlaygroundPage() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const queryClient = useQueryClient()
    const urlConvId = searchParams?.get("c") ?? null
    // `?fresh=<ts>` is the "force a new draft" signal — sidebar pushes
    // this for New chat / delete-active so the page knows to mint EVEN
    // when the user was already on a draft URL (Next.js otherwise
    // dedupes identical-pathname pushes). The token is consumed by the
    // router.replace below, so it never sticks around in the URL the
    // user sees.
    const freshToken = searchParams?.get("fresh")

    // Auto-mint a fresh client-only id whenever the URL has no `?c=`.
    // Deferred via setTimeout so a transient empty-search-params reading
    // during a router.push() transition cannot race the user's intended
    // destination — the cleanup function cancels the pending mint if
    // `urlConvId` becomes truthy before the timer fires. 50 ms is well
    // below the ~100 ms perception threshold and short enough that the
    // new-draft flow doesn't feel laggy.
    React.useEffect(() => {
        if (urlConvId) return
        const timer = setTimeout(() => {
            const fresh = crypto.randomUUID()
            // Pre-seed the messages cache so usePaginatedMessages skips
            // the page-1 fetch — without this the brand-new conv id
            // would 404 on the freshly-spawned XHR.
            queryClient.setQueryData<Message[]>(
                conversations.messagesCacheKey(fresh, INITIAL_PAGE_SIZE),
                [],
            )
            router.replace(`/playground/chat?c=${fresh}`)
        }, 50)
        return () => clearTimeout(timer)
    }, [urlConvId, freshToken, router, queryClient])

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

