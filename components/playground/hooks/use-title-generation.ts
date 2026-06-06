"use client"

import { conversations, gateway } from "@/lib/api";
import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import { usePlaygroundStore } from "@/lib/stores/playground-store"
import { useSettingsStore } from "@/lib/stores/settings-store"

import type { Message } from "@/components/playground/chat/types"

interface UseTitleGenerationOptions {
    tabId: string
    conversationId: string | undefined
    messages: Message[]
    isLoading: boolean
    getModelIds: () => string[]
}

/**
 * Hook to auto-generate conversation title after first response
 * Only generates once per conversation, skips if already has meaningful title
 */
export function useTitleGeneration({
    tabId,
    conversationId,
    messages,
    isLoading,
    getModelIds
}: UseTitleGenerationOptions): void {
    const queryClient = useQueryClient()
    const settings = useSettingsStore()
    const updateTabTitle = usePlaygroundStore((state) => state.updateTabTitle)
    const tabTitle = usePlaygroundStore(
        (state) => state.tabs.find(t => t.id === tabId)?.title
    )

    // Track if we've generated a title for this conversation
    const titleGeneratedRef = React.useRef<Set<string>>(new Set())

    React.useEffect(() => {
        if (!conversationId) return

        // Only generate title once per conversation
        if (titleGeneratedRef.current.has(conversationId)) return

        // Skip if conversation already has a meaningful title (not default)
        const defaultTitles = ['Chat', 'New Tab', 'New Chat', '']
        if (tabTitle && !defaultTitles.includes(tabTitle)) {
            titleGeneratedRef.current.add(conversationId)
            return
        }

        // Need at least one user message and one assistant response
        if (messages.length < 2) return

        const userMsg = messages.find(m => m.role === 'user')
        const assistantMsg = messages.find(m => m.role === 'assistant' && m.content && m.content.length > 10)

        if (!userMsg || !assistantMsg) return

        // Don't generate if still loading (assistant might not be done)
        if (isLoading) return

        // Mark as generated to prevent duplicate calls
        titleGeneratedRef.current.add(conversationId)

        // Get summary model from settings
        const currentModelIds = getModelIds()
        const summaryModel = settings.defaultSummaryModel || settings.defaultModel || currentModelIds[0]
        if (!summaryModel) return

        // Generate title in background
        gateway.generateTitle({ model: summaryModel, user: userMsg.content, assistant: assistantMsg.content })
            .then(title => {
                updateTabTitle(tabId, title)
                // Also update on backend
                conversations.updateTitle(conversationId, title).catch(() => {
                    // Ignore backend errors, local title is sufficient
                })
                // Refresh sidebar history
                queryClient.invalidateQueries({ queryKey: ["conversations"] })
            })
            .catch(err => {
                console.error('Failed to generate title:', err)
            })
    }, [messages, isLoading, conversationId, tabTitle, getModelIds, settings.defaultSummaryModel, settings.defaultModel, tabId, updateTabTitle, queryClient])
}
