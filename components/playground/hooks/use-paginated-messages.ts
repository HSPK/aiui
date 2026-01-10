import * as React from "react"
import { api } from "@/lib/api"

interface UsePaginatedMessagesOptions {
    conversationId?: string
    initialMessages: any[]
    setMessages: React.Dispatch<React.SetStateAction<any[]>>
    pageSize?: number
}

// Helper to transform API message to UI message
export function transformMessage(m: any) {
    return {
        id: m.id,
        role: m.role,
        content: typeof m.content === 'string'
            ? m.content
            : (Array.isArray(m.content) && m.content[0]?.text) || JSON.stringify(m.content),
        model_id: m.model_id,
        reasoning_content: m.reasoning_content,
        created_at: m.created_at,
        rating: m.rating,
        generation_id: m.generation_id,
        feedback: m.feedback
    }
}

export function usePaginatedMessages({
    conversationId,
    initialMessages,
    setMessages,
    pageSize = 20,
}: UsePaginatedMessagesOptions) {
    const [isLoadingMore, setIsLoadingMore] = React.useState(false)
    const [hasMore, setHasMore] = React.useState(true)
    const pageRef = React.useRef(2)
    const isFirstLoadRef = React.useRef(true)

    // Initial load
    React.useEffect(() => {
        // Sync pageRef based on loaded messages
        if (isFirstLoadRef.current && initialMessages.length > 0) {
            isFirstLoadRef.current = false
            const p = Math.floor(initialMessages.length / pageSize) + 1
            pageRef.current = p
        }

        // Fetch initial messages if needed
        if (conversationId && initialMessages.length === 0 && isFirstLoadRef.current) {
            isFirstLoadRef.current = false

            const fetchInitial = async () => {
                try {
                    const res = await api.getConversationMessages(conversationId, {
                        page: 1,
                        page_size: pageSize,
                        sort: "-created_at"
                    })

                    if (res.items.length > 0) {
                        const newMsgs = res.items.reverse().map(transformMessage)
                        setMessages(newMsgs)
                        setHasMore(res.items.length >= pageSize)
                        pageRef.current = 2
                    } else {
                        setHasMore(false)
                    }
                } catch (e) {
                    console.error("Failed to load initial messages", e)
                }
            }
            fetchInitial()
        }
    }, [conversationId, initialMessages.length, setMessages, pageSize])

    // Load more function
    const loadMore = React.useCallback(async () => {
        if (!hasMore || isLoadingMore || !conversationId) return null

        setIsLoadingMore(true)

        try {
            const res = await api.getConversationMessages(conversationId, {
                page: pageRef.current,
                page_size: pageSize,
                sort: '-created_at'
            })

            if (res.items.length < pageSize) setHasMore(false)

            if (res.items.length > 0) {
                pageRef.current += 1
                const newMessages = res.items.reverse().map(transformMessage)

                // Prepend messages with deduplication
                setMessages(prev => {
                    const existingIds = new Set(prev.map(m => m.id))
                    const uniqueNewMessages = newMessages.filter(m => !existingIds.has(m.id))
                    if (uniqueNewMessages.length === 0) return prev
                    return [...uniqueNewMessages, ...prev]
                })

                return newMessages
            }
            return null
        } catch (e) {
            console.error("Failed to load more messages", e)
            return null
        } finally {
            setIsLoadingMore(false)
        }
    }, [hasMore, isLoadingMore, conversationId, setMessages, pageSize])

    return {
        isLoadingMore,
        hasMore,
        loadMore,
    }
}
