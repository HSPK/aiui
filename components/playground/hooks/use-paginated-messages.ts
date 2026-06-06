import { ApiError, conversations } from "@/lib/api";
import * as React from "react"
import type { Message } from "@/components/playground/chat/types"
import type { MessageDTO } from "@/lib/schemas/conversation"

interface UsePaginatedMessagesOptions {
    conversationId?: string
    initialMessages: Message[]
    setMessages: React.Dispatch<React.SetStateAction<Message[]>>
    pageSize?: number
}

/** Convert a server `MessageDTO` to the FE-canonical `Message`.
 *  This is the single conversion point between wire-format (where
 *  `content` is the OpenAI-style `[{type:"text", text:"..."}]` array)
 *  and the hook/store shape (where `content` is a plain string). */
export function transformMessage(m: MessageDTO): Message {
    const raw = m.content
    let content: string
    if (typeof raw === "string") {
        content = raw
    } else if (Array.isArray(raw) && typeof raw[0]?.text === "string") {
        content = raw[0].text
    } else if (raw == null) {
        content = ""
    } else {
        content = JSON.stringify(raw)
    }
    return {
        id: m.id,
        role: m.role === "tool" ? "assistant" : m.role,
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
                    const res = await conversations.listMessages(conversationId, {
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
                    // 404 = no server-side conversation row yet (the FE
                    // generates the id up-front and the server creates the
                    // row on first message). Treat as "no messages".
                    if (e instanceof ApiError && e.status === 404) {
                        setHasMore(false)
                        return
                    }
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
            const res = await conversations.listMessages(conversationId, {
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
            // Same as initial load: a 404 means the conversation never made
            // it to the server (no messages sent yet) — treat as "no more".
            if (e instanceof ApiError && e.status === 404) {
                setHasMore(false)
                return null
            }
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
