// Refactored Chat Hook - clean orchestration layer

import { useEffect, useState, useRef, useCallback, startTransition } from "react"
import { toast } from "sonner"
import { useChatStream } from "./chat"
import type { Message, ChatOptions } from "./chat"

export { type Message } from "./chat"

type UsePlaygroundChatOptions = {
    initialMessages?: Message[]
    conversationId?: string
    /** Minimum interval (ms) between UI updates during streaming. Default: 100ms */
    updateInterval?: number
}

export function usePlaygroundChat({
    initialMessages = [],
    conversationId,
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
    const { streamMultiple, retryFailedMessage, stopAll } = useChatStream(
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
                config: options?.config,
                getModelConfig: options?.getModelConfig
            })
        } catch (err) {
            console.error("Chat Error:", err)
            setError(err instanceof Error ? err : new Error(String(err)))
        } finally {
            setIsLoading(false)
        }
    }, [streamMultiple])

    /** Retry a single failed assistant slot — invoked from the inline
     *  error card. There is intentionally no "retry last user message"
     *  surface; per-message retry covers single- and multi-model runs
     *  uniformly (a failed slot retries that one model, successful
     *  siblings stay untouched). */
    const handleRetryFailed = useCallback(async (
        failedAssistantId: string,
        options?: ChatOptions
    ) => {
        if (isLoadingRef.current) return

        const currentMessages = messagesRef.current
        const failed = currentMessages.find(m => m.id === failedAssistantId)
        if (!failed || !failed.error) return

        const userMessage = currentMessages.find(m => m.id === failed.parent_id)
        if (!userMessage) return

        setError(null)
        setIsLoading(true)

        try {
            await retryFailedMessage(
                failed,
                userMessage.content,
                options?.getModelConfig
            )
        } catch (err) {
            console.error("Chat Retry Failed Error:", err)
            setError(err instanceof Error ? err : new Error(String(err)))
        } finally {
            setIsLoading(false)
        }
    }, [retryFailedMessage])

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
                config: options?.config,
                getModelConfig: options?.getModelConfig
            })
        } catch (err) {
            console.error("Chat Regenerate Error:", err)
            setError(err instanceof Error ? err : new Error(String(err)))
        } finally {
            setIsLoading(false)
        }
    }, [streamMultiple])

    return {
        messages,
        handleSubmit,
        handleRetryFailed,
        handleRegenerate,
        isLoading,
        setMessages,
        error,
        stop,
    }
}

// ============ Helper Functions ============

function normalizeMessages(messages: Message[]): Message[] {
    if (!messages?.length) return []
    return messages.map((m, i) => ({
        ...m,
        id: m.id || `init-${i}`,
        role: m.role || "user",
        content: m.content ?? ""
    }))
}

function findLastAssistantMessage(messages: Message[]): Message | null {
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'assistant') {
            return messages[i]
        }
    }
    return null
}
