"use client"

import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"

import { conversations } from "@/lib/api/conversations"
import type { Message } from "@/components/playground/chat/types"

interface UseMessageSyncOptions {
    conversationId: string | undefined
    messages: Message[]
    isLoading: boolean
    pageSize: number
}

/** After a streaming run completes:
 *  - Refresh the sidebar conversation list (new title / updated_at).
 *  - Write the current message tail into the per-conversation messages
 *    cache so that switching away and back stays in sync with what the
 *    user just sent (no stale flash).
 *
 *  The invalidator is list-only — it deliberately does NOT touch the
 *  per-conversation messages cache, which is the whole point of having
 *  the cache survive conversation switches. */
export function useMessageSync({
    conversationId,
    messages,
    isLoading,
    pageSize,
}: UseMessageSyncOptions): void {
    const invalidateList = conversations.useInvalidateList()
    const queryClient = useQueryClient()
    const prevLoadingRef = React.useRef(isLoading)

    React.useEffect(() => {
        const justFinished = prevLoadingRef.current && !isLoading
        prevLoadingRef.current = isLoading
        if (!justFinished) return

        invalidateList()

        if (conversationId && messages.length > 0) {
            // Keep the cache aligned with the head of the visible list so
            // a quick switch-away-and-back doesn't show pre-stream state.
            queryClient.setQueryData<Message[]>(
                conversations.messagesCacheKey(conversationId, pageSize),
                messages.slice(-pageSize)
            )
        }
    }, [isLoading, conversationId, messages, pageSize, invalidateList, queryClient])
}
