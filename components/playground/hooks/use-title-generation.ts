"use client"

import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"

import { conversations, gateway, preferences } from "@/lib/api"
import { extractText } from "@/lib/schemas/content"
import type { ConversationDTO } from "@/lib/schemas/conversation"
import type { Paginated } from "@/lib/schemas/common"
import type { Message } from "@/components/playground/chat/types"

interface UseTitleGenerationOptions {
    conversationId: string | undefined
    messages: Message[]
    isLoading: boolean
    getModelIds: () => string[]
}

const DEFAULT_TITLES = new Set(["", "New Chat", "Chat", "New Tab"])

type ConvCacheEntry = Paginated<ConversationDTO> | { pages?: Paginated<ConversationDTO>[] }

/** Auto-generate a conversation title the first time a fresh chat
 *  produces an assistant response. Guards:
 *  - hasStreamedRef: must have observed a stream complete this mount
 *    (prevents firing on simple reopen of an already-loaded chat)
 *  - cached title check: skip if the sidebar list already shows a
 *    non-default title for this conversation (prevents bumping
 *    updated_at on subsequent sends to an existing conversation). */
export function useTitleGeneration({
    conversationId,
    messages,
    isLoading,
    getModelIds,
}: UseTitleGenerationOptions): void {
    const invalidateConversations = conversations.useInvalidate()
    const { data: userPrefs } = preferences.useGet()
    const defaultSummaryModel = userPrefs?.default_summary_model ?? ""
    const defaultModel = userPrefs?.default_model ?? ""
    const queryClient = useQueryClient()

    const generatedRef = React.useRef<Set<string>>(new Set())
    const hasStreamedRef = React.useRef(false)
    const prevLoadingRef = React.useRef(isLoading)

    React.useEffect(() => {
        if (isLoading) hasStreamedRef.current = true
        const justFinished = prevLoadingRef.current && !isLoading
        prevLoadingRef.current = isLoading

        if (!justFinished) return
        if (!conversationId) return
        if (generatedRef.current.has(conversationId)) return
        if (!hasStreamedRef.current) return
        if (messages.length < 2) return

        const userMsg = messages.find((m) => m.role === "user")
        const assistantMsg = messages.find(
            (m) => m.role === "assistant" && m.content && m.content.length > 10
        )
        if (!userMsg || !assistantMsg) return

        const cachedTitle = readCachedTitle(queryClient, conversationId)
        if (cachedTitle != null && !DEFAULT_TITLES.has(cachedTitle)) {
            generatedRef.current.add(conversationId)
            return
        }

        generatedRef.current.add(conversationId)
        const summaryModel = defaultSummaryModel || defaultModel || getModelIds()[0]
        if (!summaryModel) return

        gateway
            .generateTitle({
                model: summaryModel,
                user: extractText(userMsg.content),
                assistant: extractText(assistantMsg.content),
            })
            .then((title) => {
                conversations.updateTitle(conversationId, title).catch(() => {
                    /* sidebar still shows existing title; ignore */
                })
                invalidateConversations()
            })
            .catch((err) => console.error("Failed to generate title:", err))
    }, [
        messages,
        isLoading,
        conversationId,
        getModelIds,
        defaultSummaryModel,
        defaultModel,
        invalidateConversations,
        queryClient,
    ])
}

/** Look up a conversation's title from any cached list/infinite query
 *  for the conversations resource. Returns null if not in cache (which
 *  is the case for brand-new conversations until the sidebar refreshes). */
function readCachedTitle(
    queryClient: ReturnType<typeof useQueryClient>,
    conversationId: string
): string | null {
    const entries = queryClient.getQueriesData<ConvCacheEntry>({
        queryKey: conversations.keys.all(),
    })
    for (const [, data] of entries) {
        if (!data) continue
        const pages = (data as { pages?: Paginated<ConversationDTO>[] }).pages
        const items: ConversationDTO[] = pages
            ? pages.flatMap((p) => p?.items ?? [])
            : ((data as Paginated<ConversationDTO>).items ?? [])
        const match = items.find((c) => c.id === conversationId)
        if (match) return match.title
    }
    return null
}
