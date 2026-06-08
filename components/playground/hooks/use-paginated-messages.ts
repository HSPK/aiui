import * as React from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"

import { ApiError, conversations } from "@/lib/api"
import type { Message } from "@/components/playground/chat/types"
import type { MessageDTO } from "@/lib/schemas/conversation"

interface UsePaginatedMessagesOptions {
    conversationId?: string
    initialMessages: Message[]
    setMessages: React.Dispatch<React.SetStateAction<Message[]>>
    pageSize?: number
}

/** Convert a server `MessageDTO` to the FE-canonical `Message`. Single
 *  conversion point — wire format `content` may be a string or an array
 *  of content parts (OpenAI multimodal shape); we pass either through
 *  verbatim so multimodal renders and round-trips. */
export function transformMessage(m: MessageDTO): Message {
    const raw = m.content
    let content: Message["content"]
    if (typeof raw === "string") {
        content = raw
    } else if (Array.isArray(raw)) {
        // Trust the array — chat-completion content parts.
        content = raw as Message["content"]
    } else if (raw == null) {
        content = ""
    } else {
        content = JSON.stringify(raw)
    }
    return {
        id: m.id,
        // Preserve `tool` — message-list folds these into the parent
        // assistant's tool_calls[].result so they don't render as
        // standalone bubbles.
        role: m.role,
        content,
        model_id: m.model_id,
        reasoning_content: m.reasoning_content,
        created_at: m.created_at,
        rating: m.rating,
        generation_id: m.generation_id,
        feedback: m.feedback,
        parent_id: m.parent_id,
        error: m.error,
    }
}

/** Read the cached initial-page `Message[]` for a conversation, if any.
 *  Synchronous — safe to call during render to seed component state and
 *  avoid the loading flash when switching to a recently-viewed chat. */
export function readCachedMessages(
    queryClient: ReturnType<typeof useQueryClient>,
    conversationId: string | undefined,
    pageSize = 20
): Message[] | null {
    if (!conversationId) return null
    return (
        queryClient.getQueryData<Message[]>(
            conversations.messagesCacheKey(conversationId, pageSize)
        ) ?? null
    )
}

/** Fetches + caches the first page of messages for a conversation, then
 *  paginates older messages on demand. The initial page lives in
 *  TanStack Query (staleTime 5min, gcTime 10min) so revisiting a chat
 *  within that window is instant. */
export function usePaginatedMessages({
    conversationId,
    initialMessages,
    setMessages,
    pageSize = 20,
}: UsePaginatedMessagesOptions) {
    const queryClient = useQueryClient()
    const [isLoadingMore, setIsLoadingMore] = React.useState(false)
    const [hasMore, setHasMore] = React.useState(true)
    const pageRef = React.useRef(2)
    const hydratedRef = React.useRef<string | null>(null)

    const query = useQuery({
        queryKey: conversationId
            ? conversations.messagesCacheKey(conversationId, pageSize)
            : ["conversations", "no-id", "messages-cache", pageSize],
        queryFn: async (): Promise<Message[]> => {
            if (!conversationId) return []
            try {
                const res = await conversations.listMessages(conversationId, {
                    page: 1,
                    page_size: pageSize,
                    sort: "-created_at",
                })
                return res.items.slice().reverse().map(transformMessage)
            } catch (e) {
                // 404 = no server-side conversation row yet (FE generates the
                // id up-front; the server creates the row on first message).
                if (e instanceof ApiError && e.status === 404) return []
                throw e
            }
        },
        enabled: !!conversationId,
        staleTime: 5 * 60 * 1000,
        gcTime: 10 * 60 * 1000,
    })

    // Hydrate local message state from the query (once per conversation).
    // Skips overwriting if the parent already has messages (e.g. mid-stream).
    React.useEffect(() => {
        if (!conversationId) return
        if (hydratedRef.current === conversationId) return
        const data = query.data
        if (!data) return
        hydratedRef.current = conversationId

        if (initialMessages.length === 0) {
            setMessages(data)
            setHasMore(data.length >= pageSize)
            pageRef.current = data.length > 0 ? 2 : 1
        } else {
            pageRef.current = Math.floor(initialMessages.length / pageSize) + 1
        }
    }, [conversationId, query.data, initialMessages.length, setMessages, pageSize])

    const loadMore = React.useCallback(async () => {
        if (!hasMore || isLoadingMore || !conversationId) return null

        setIsLoadingMore(true)

        try {
            const res = await conversations.listMessages(conversationId, {
                page: pageRef.current,
                page_size: pageSize,
                sort: "-created_at",
            })

            if (res.items.length < pageSize) setHasMore(false)

            if (res.items.length > 0) {
                pageRef.current += 1
                const newMessages = res.items.slice().reverse().map(transformMessage)

                setMessages((prev) => {
                    const existingIds = new Set(prev.map((m) => m.id))
                    const unique = newMessages.filter((m) => !existingIds.has(m.id))
                    if (unique.length === 0) return prev
                    const merged = [...unique, ...prev]
                    // Keep the cache in sync with the visible head of the list.
                    queryClient.setQueryData<Message[]>(
                        conversations.messagesCacheKey(conversationId, pageSize),
                        merged.slice(0, pageSize)
                    )
                    return merged
                })

                return newMessages
            }
            return null
        } catch (e) {
            if (e instanceof ApiError && e.status === 404) {
                setHasMore(false)
                return null
            }
            console.error("Failed to load more messages", e)
            return null
        } finally {
            setIsLoadingMore(false)
        }
    }, [hasMore, isLoadingMore, conversationId, setMessages, pageSize, queryClient])

    // True only when we have no data yet and a fetch is in flight. False on
    // cache hit so the chat surface shows messages immediately on switch.
    const isInitialLoading = query.isLoading && !query.data

    return {
        isLoadingMore,
        hasMore,
        loadMore,
        isInitialLoading,
    }
}
