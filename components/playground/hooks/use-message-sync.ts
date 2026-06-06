"use client"

import * as React from "react"
import { conversations } from "@/lib/api"
import { usePlaygroundStore } from "@/lib/stores/playground-store"
import type { Message } from "@/components/playground/chat/types"

interface UseMessageSyncOptions {
    tabId: string
    conversationId: string | undefined
    messages: Message[]
    isLoading: boolean
}

/**
 * Hook to sync messages to store and refresh sidebar.
 *
 * - Debounced (1s) write of the hook's authoritative `Message[]` into
 *   the store. We persist the same shape we hold in component state —
 *   `Message` from `chat/types` — so there's no round-trip conversion
 *   between hook and store. (Wire-format conversion happens once at
 *   the server boundary in `usePaginatedMessages.transformMessage`.)
 * - Refresh the sidebar when streaming completes so the conversation
 *   list picks up the new title / preview.
 */
export function useMessageSync({
    tabId,
    conversationId: _conversationId,
    messages,
    isLoading
}: UseMessageSyncOptions): void {
    const updateTab = usePlaygroundStore((state) => state.updateTab)
    const invalidateConversations = conversations.useInvalidate()

    React.useEffect(() => {
        const timeout = setTimeout(() => {
            updateTab(tabId, { messages })
        }, 1000)
        return () => clearTimeout(timeout)
    }, [messages, updateTab, tabId])

    // Refresh sidebar when message sending completes
    const prevIsLoadingRef = React.useRef(isLoading)
    React.useEffect(() => {
        if (prevIsLoadingRef.current && !isLoading && messages.length > 0) {
            invalidateConversations()
        }
        prevIsLoadingRef.current = isLoading
    }, [isLoading, messages.length, invalidateConversations])
}
