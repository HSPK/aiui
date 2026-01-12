// Refactored Chat Hook - clean orchestration layer

import { useEffect, useState, useRef, useCallback, startTransition } from "react"
import { toast } from "sonner"
import { useChatStream } from "./chat"
import type { Message, ChatOptions } from "./chat"

export { type Message } from "./chat"

type UsePlaygroundChatOptions = {
    initialMessages?: any[]
    conversationId?: string
    onConversationCreated?: (id: string, groupId?: string) => void
    /** Minimum interval (ms) between UI updates during streaming. Default: 100ms */
    updateInterval?: number
}

export function usePlaygroundChat({
    initialMessages = [],
    conversationId,
    onConversationCreated,
    updateInterval = 100,
}: UsePlaygroundChatOptions) {
    // ============ State ============
    const [messages, setMessages] = useState<Message[]>(() =>
        normalizeMessages(initialMessages)
    )
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<Error | null>(null)

    // Track which conversation we've initialized
    const initializedRef = useRef<string | null>(conversationId || "new")

    // Use ref to access messages without causing re-renders
    const messagesRef = useRef(messages)
    messagesRef.current = messages

    // Track loading state in ref for stable callbacks
    const isLoadingRef = useRef(isLoading)
    isLoadingRef.current = isLoading

    // ============ Stream Hook ============
    const { streamMultiple, stopAll } = useChatStream(
        conversationId,
        setMessages,
        updateInterval
    )

    // ============ Sync Effect ============
    useEffect(() => {
        if (isLoading) return

        const currentId = conversationId || "new"
        if (initializedRef.current !== currentId) {
            initializedRef.current = currentId
            setMessages(normalizeMessages(initialMessages))
        }
    }, [initialMessages, conversationId, isLoading])

    // ============ Actions ============

    const stop = useCallback(() => {
        stopAll()
        setIsLoading(false)
    }, [stopAll])

    const handleSubmit = useCallback(async (
        inputText: string,
        options?: ChatOptions
    ) => {
        const userContent = inputText?.trim()
        if (!userContent || isLoadingRef.current) return

        const models = options?.models
        if (!models?.length) {
            toast.error("Please select a model first")
            return
        }

        // Set loading immediately (high priority)
        setError(null)
        setIsLoading(true)

        // Use ref to get current messages without dependency
        const currentMessages = messagesRef.current

        // Determine parent for user message
        const userParentId = options?.contextMessageId
            ?? currentMessages[currentMessages.length - 1]?.id

        // Create user message
        const userMsgId = crypto.randomUUID()
        const userMsg: Message = {
            id: userMsgId,
            role: "user",
            content: userContent,
            parent_id: userParentId,
            created_at: new Date()
        }

        // Add user message with low priority - allows input to clear first
        startTransition(() => {
            setMessages(prev => [...prev, userMsg])
        })

        // Stream in background
        try {
            await streamMultiple({
                userMessageId: userMsgId,
                userContent,
                parentMessageId: userParentId,
                models,
                config: options?.config
            })
        } catch (err: any) {
            console.error("Chat Error:", err)
            setError(err)
        } finally {
            setIsLoading(false)
        }
    }, [streamMultiple]) // Remove messages dependency!

    const handleRetry = useCallback(async (options?: ChatOptions) => {
        const currentMessages = messagesRef.current
        if (isLoadingRef.current || !lastMessageIsUser(currentMessages)) return

        const models = options?.models
        if (!models?.length) {
            toast.error("Please select a model first")
            return
        }

        setError(null)
        setIsLoading(true)

        try {
            const lastUserMessage = currentMessages[currentMessages.length - 1]

            await streamMultiple({
                userMessageId: lastUserMessage.id,
                userContent: lastUserMessage.content,
                parentMessageId: lastUserMessage.parent_id,
                models,
                config: options?.config
            })
        } catch (err: any) {
            console.error("Chat Retry Error:", err)
            setError(err)
        } finally {
            setIsLoading(false)
        }
    }, [streamMultiple]) // Remove messages/isLoading dependency!

    const handleRegenerate = useCallback(async (options?: ChatOptions) => {
        if (isLoadingRef.current) return

        const models = options?.models
        if (!models?.length) {
            toast.error("Please select a model first")
            return
        }

        const currentMessages = messagesRef.current

        // Find last assistant message
        const lastAssistant = findLastAssistantMessage(currentMessages)
        if (!lastAssistant) {
            toast.error("No assistant message to regenerate")
            return
        }

        // Find parent user message
        const userMessage = currentMessages.find(m => m.id === lastAssistant.parent_id)
        if (!userMessage) {
            toast.error("Cannot find parent user message")
            return
        }

        setError(null)
        setIsLoading(true)

        try {
            await streamMultiple({
                userMessageId: userMessage.id,
                userContent: userMessage.content,
                parentMessageId: userMessage.parent_id,
                models,
                config: options?.config
            })
        } catch (err: any) {
            console.error("Chat Regenerate Error:", err)
            setError(err)
        } finally {
            setIsLoading(false)
        }
    }, [streamMultiple]) // Remove messages/isLoading dependency!

    // ============ Computed ============
    const isLastMessageUser = lastMessageIsUser(messages)

    return {
        messages,
        handleSubmit,
        handleRetry,
        handleRegenerate,
        isLoading,
        setMessages,
        error,
        stop,
        lastMessageIsUser: isLastMessageUser
    }
}

// ============ Helper Functions ============

function normalizeMessages(messages: any[]): Message[] {
    if (!messages?.length) return []

    return messages.map((m, i) => ({
        ...m,
        id: m.id || `init-${i}`,
        role: m.role || "user",
        content: m.content || ""
    }))
}

function lastMessageIsUser(messages: Message[]): boolean {
    return messages.length > 0 && messages[messages.length - 1].role === "user"
}

function findLastAssistantMessage(messages: Message[]): Message | null {
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'assistant') {
            return messages[i]
        }
    }
    return null
}
