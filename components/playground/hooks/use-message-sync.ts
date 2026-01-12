"use client"

import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import { usePlaygroundStore } from "@/lib/stores/playground-store"
import type { Message } from "@/components/playground/chat/types"

interface UseMessageSyncOptions {
    tabId: string
    conversationId: string | undefined
    messages: Message[]
    isLoading: boolean
}

/**
 * Hook to sync messages to store and refresh sidebar
 * - Debounced sync to store (1s delay)
 * - Refresh sidebar when loading completes
 */
export function useMessageSync({
    tabId,
    conversationId,
    messages,
    isLoading
}: UseMessageSyncOptions): void {
    const queryClient = useQueryClient()
    const updateTab = usePlaygroundStore((state) => state.updateTab)

    // Sync messages to store (debounced)
    React.useEffect(() => {
        const timeout = setTimeout(() => {
            const storeMessages = messages.map((m) => {
                let contentVal = m.content
                if (typeof contentVal !== 'string') {
                    if (Array.isArray(contentVal) && (contentVal as any)[0]?.text) {
                        contentVal = (contentVal as any)[0].text
                    } else if (typeof contentVal === 'object' && contentVal !== null) {
                        contentVal = JSON.stringify(contentVal)
                    }
                }

                return {
                    id: m.id,
                    conversation_id: conversationId || "",
                    role: m.role as any,
                    content: [{ type: "text", text: String(contentVal) }],
                    model_id: m.model_id,
                    reasoning_content: m.reasoning_content,
                    is_active: true,
                    created_at: m.created_at || new Date().toISOString(),
                    rating: m.rating,
                    generation_id: m.generation_id,
                    feedback: m.feedback,
                    parent_id: m.parent_id
                }
            })
            updateTab(tabId, { messages: storeMessages as any })
        }, 1000)

        return () => clearTimeout(timeout)
    }, [messages, updateTab, tabId, conversationId])

    // Refresh sidebar when message sending completes
    const prevIsLoadingRef = React.useRef(isLoading)
    React.useEffect(() => {
        // Detect transition from loading to not loading (message sent)
        if (prevIsLoadingRef.current && !isLoading && messages.length > 0) {
            queryClient.invalidateQueries({ queryKey: ["conversations"] })
        }
        prevIsLoadingRef.current = isLoading
    }, [isLoading, messages.length, queryClient])
}
