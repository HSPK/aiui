// Proxy for the Chat backend

import { useEffect, useState, useRef, useCallback } from "react"
import { toast } from "sonner"
import { flushSync } from "react-dom"
import { getAuthHeader } from "@/lib/api"

export type Message = {
    id: string
    role: "user" | "assistant" | "system"
    content: string
    reasoning_content?: string
    model_id?: string
    parent_id?: string  // parent message id for tree structure
    created_at?: Date | string
    createdAt?: Date | string
}

export function usePlaygroundChat({
    initialMessages = [],
    conversationId,
    onConversationCreated,
    updateInterval = 100,
}: {
    initialMessages?: any[]
    conversationId?: string
    onConversationCreated?: (id: string, groupId?: string) => void
    /** Minimum interval (ms) between UI updates during streaming. Default: 50ms */
    updateInterval?: number
}) {
    const [messages, setMessages] = useState<Message[]>(() => {
        if (initialMessages && initialMessages.length > 0) {
            return initialMessages.map((m, i) => ({
                ...m,
                id: m.id || `init-${i}`, // Use index to be deterministic during hydration
                role: m.role || "user",
                content: m.content || ""
            }))
        }
        return []
    })

    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<Error | null>(null)

    const abortControllersRef = useRef<AbortController[]>([])
    const initializedRef = useRef<string | null>(conversationId || "new")

    // Sync initial messages when conversationId changes
    useEffect(() => {
        if (isLoading) return

        const currentId = conversationId || "new"
        if (initializedRef.current !== currentId) {
            initializedRef.current = currentId
            if (initialMessages && initialMessages.length > 0) {
                setMessages(initialMessages.map(m => ({
                    ...m,
                    id: m.id || crypto.randomUUID(),
                    role: m.role || "user",
                    content: m.content || ""
                })))
            } else {
                setMessages([])
            }
        }
    }, [initialMessages, conversationId, isLoading])

    const stop = useCallback(() => {
        if (abortControllersRef.current.length > 0) {
            abortControllersRef.current.forEach(c => c.abort())
            abortControllersRef.current = []
        }
        setIsLoading(false)
    }, [])

    const handleSubmit = async (inputText: string, options?: { models: string[]; config: any; contextMessageId?: string }) => {
        const userContent = inputText?.trim() || ""
        if (!userContent) return
        if (isLoading) return

        if (!options?.models || options.models.length === 0) {
            toast.error("Please select a model first")
            return
        }
        const models = options.models
        setError(null)
        setIsLoading(true)

        // Determine parent for the new user message (context assistant selected by UI if provided)
        const userParentId = options.contextMessageId
            ? options.contextMessageId
            : (messages.length > 0 ? messages[messages.length - 1].id : undefined)

        const userMsgId = crypto.randomUUID()
        const userMsg: Message = {
            id: userMsgId,
            role: "user",
            content: userContent,
            parent_id: userParentId,
            created_at: new Date()
        }

        // Create assistant placeholders, one per model
        const assistantMsgs = models.map(model => ({
            id: crypto.randomUUID(),
            role: "assistant" as const,
            content: "",
            model_id: model,
            parent_id: userMsgId,
            created_at: new Date()
        }))

        setMessages(prev => [...prev, userMsg, ...assistantMsgs])

        const tasks = assistantMsgs.map((assistantMsg, idx) => {
            const model = models[idx]
            const controller = new AbortController()
            abortControllersRef.current.push(controller)

            let accumulatedContent = ""
            let accumulatedReasoning = ""
            let serverMessageId: string | null = null
            let serverGenerationId: string | null = null

            const MIN_UPDATE_INTERVAL = updateInterval
            let lastUpdateTime = 0
            let isFirstUpdate = true
            let pendingTimeout: ReturnType<typeof setTimeout> | null = null

            const updateMessage = (content: string, reasoning: string, force = false, includeIds = false) => {
                const now = Date.now()
                const timeSinceLastUpdate = now - lastUpdateTime

                if (pendingTimeout) {
                    clearTimeout(pendingTimeout)
                    pendingTimeout = null
                }

                const getUpdate = () => {
                    const update: any = { content, reasoning_content: reasoning || undefined }
                    if (includeIds) {
                        if (serverMessageId) update.id = serverMessageId
                        if (serverGenerationId) update.generation_id = serverGenerationId
                    }
                    return update
                }

                if (isFirstUpdate || force) {
                    isFirstUpdate = false
                    lastUpdateTime = now
                    const updateObj = getUpdate()
                    flushSync(() => {
                        setMessages(prev =>
                            prev.map(m =>
                                (m.id === assistantMsg.id || m.id === serverMessageId)
                                    ? { ...m, ...updateObj }
                                    : m
                            )
                        )
                    })
                    return
                }

                if (timeSinceLastUpdate >= MIN_UPDATE_INTERVAL) {
                    lastUpdateTime = now
                    flushSync(() => {
                        setMessages(prev =>
                            prev.map(m =>
                                (m.id === assistantMsg.id || m.id === serverMessageId)
                                    ? { ...m, ...getUpdate() }
                                    : m
                            )
                        )
                    })
                } else {
                    pendingTimeout = setTimeout(() => {
                        lastUpdateTime = Date.now()
                        flushSync(() => {
                            setMessages(prev =>
                                prev.map(m =>
                                    (m.id === assistantMsg.id || m.id === serverMessageId)
                                        ? { ...m, content, reasoning_content: reasoning || undefined }
                                        : m
                                )
                            )
                        })
                    }, MIN_UPDATE_INTERVAL - timeSinceLastUpdate)
                }
            }

            const run = async () => {
                try {
                    const res = await fetch("/api/playground/chat", {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            Authorization: getAuthHeader() || ""
                        },
                        body: JSON.stringify({
                            conversation_id: conversationId,
                            model: model,
                            message: userContent,
                            user_message_id: userMsgId,
                            parent_message_id: userParentId || null,
                            ...options.config
                        }),
                        signal: controller.signal
                    })

                    if (!res.ok) {
                        const text = await res.text()
                        throw new Error(text || res.statusText)
                    }

                    serverMessageId = res.headers.get("X-Message-ID")
                    serverGenerationId = res.headers.get("X-Generation-ID")

                    if (!res.body) throw new Error("No response body")

                    const reader = res.body.getReader()
                    const decoder = new TextDecoder()
                    let buffer = ""
                    let currentEvent: string | null = null

                    while (true) {
                        const { value, done } = await reader.read()
                        if (done) break

                        buffer += decoder.decode(value, { stream: true })
                        const lines = buffer.split("\n")
                        buffer = lines.pop() || ""

                        for (const line of lines) {
                            const trimmed = line.trim()
                            if (!trimmed) continue

                            if (trimmed.startsWith("event:")) {
                                currentEvent = trimmed.slice(6).trim()
                                continue
                            }

                            if (!trimmed.startsWith("data: ")) continue

                            const dataStr = trimmed.slice(6)

                            if (currentEvent === "error") {
                                currentEvent = null
                                try {
                                    const data = JSON.parse(dataStr)
                                    const msg = data?.error?.message || "Streaming error"
                                    throw new Error(msg)
                                } catch (err) {
                                    throw err instanceof Error ? err : new Error(String(err))
                                }
                            }

                            currentEvent = null

                            if (dataStr === "[DONE]") {
                                updateMessage(accumulatedContent, accumulatedReasoning, true, true)
                                break
                            }

                            try {
                                const data = JSON.parse(dataStr)
                                const delta = data.choices?.[0]?.delta
                                const content = delta?.content
                                const reasoning = delta?.reasoning_content

                                let hasUpdate = false

                                if (reasoning) {
                                    accumulatedReasoning += reasoning
                                    hasUpdate = true
                                }
                                if (content) {
                                    accumulatedContent += content
                                    hasUpdate = true
                                }

                                if (hasUpdate) {
                                    updateMessage(accumulatedContent, accumulatedReasoning)
                                }
                            } catch {
                                // ignore parse errors
                            }
                        }
                    }
                    updateMessage(accumulatedContent, accumulatedReasoning, true, true)
                } catch (err: any) {
                    if (err.name === "AbortError") {
                        updateMessage(accumulatedContent, accumulatedReasoning, true, true)
                    } else {
                        console.error("Chat Error:", err)
                        setError(err)
                        toast.error(err.message || "Failed to send message")
                        // Remove the failed assistant message from the list
                        setMessages(prev =>
                            prev.filter(m => m.id !== assistantMsg.id && m.id !== serverMessageId)
                        )
                    }
                }
            }

            return run()
        })

        try {
            await Promise.allSettled(tasks)
        } finally {
            setIsLoading(false)
            abortControllersRef.current = []
        }
    }

    // Check if last message is from user (needs retry, can't send new message)
    const lastMessageIsUser = messages.length > 0 && messages[messages.length - 1].role === "user"

    // Retry: resend the last user message with the same parent (supports multi-model)
    const handleRetry = useCallback(async (options?: { models: string[]; config: any }) => {
        if (isLoading) return
        if (!lastMessageIsUser) return

        if (!options?.models || options.models.length === 0) {
            toast.error("Please select a model first")
            return
        }

        const models = options.models
        const lastUserMessage = messages[messages.length - 1]
        const userContent = lastUserMessage.content
        const userParentId = lastUserMessage.parent_id

        setError(null)
        setIsLoading(true)

        const assistantMsgs = models.map(model => ({
            id: crypto.randomUUID(),
            role: "assistant" as const,
            content: "",
            model_id: model,
            parent_id: lastUserMessage.id,
            created_at: new Date()
        }))

        setMessages(prev => [...prev, ...assistantMsgs])

        const tasks = assistantMsgs.map((assistantMsg, idx) => {
            const model = models[idx]
            const controller = new AbortController()
            abortControllersRef.current.push(controller)

            let accumulatedContent = ""
            let accumulatedReasoning = ""
            let serverMessageId: string | null = null
            let serverGenerationId: string | null = null

            const MIN_UPDATE_INTERVAL = updateInterval
            let lastUpdateTime = 0
            let isFirstUpdate = true
            let pendingTimeout: ReturnType<typeof setTimeout> | null = null

            const updateMessage = (content: string, reasoning: string, force = false, includeIds = false) => {
                const now = Date.now()
                const timeSinceLastUpdate = now - lastUpdateTime

                if (pendingTimeout) {
                    clearTimeout(pendingTimeout)
                    pendingTimeout = null
                }

                const getUpdate = () => {
                    const update: any = { content, reasoning_content: reasoning || undefined }
                    if (includeIds) {
                        if (serverMessageId) update.id = serverMessageId
                        if (serverGenerationId) update.generation_id = serverGenerationId
                    }
                    return update
                }

                if (isFirstUpdate || force) {
                    isFirstUpdate = false
                    lastUpdateTime = now
                    const updateObj = getUpdate()
                    flushSync(() => {
                        setMessages(prev =>
                            prev.map(m =>
                                (m.id === assistantMsg.id || m.id === serverMessageId)
                                    ? { ...m, ...updateObj }
                                    : m
                            )
                        )
                    })
                    return
                }

                if (timeSinceLastUpdate >= MIN_UPDATE_INTERVAL) {
                    lastUpdateTime = now
                    flushSync(() => {
                        setMessages(prev =>
                            prev.map(m =>
                                (m.id === assistantMsg.id || m.id === serverMessageId)
                                    ? { ...m, ...getUpdate() }
                                    : m
                            )
                        )
                    })
                } else {
                    pendingTimeout = setTimeout(() => {
                        lastUpdateTime = Date.now()
                        flushSync(() => {
                            setMessages(prev =>
                                prev.map(m =>
                                    (m.id === assistantMsg.id || m.id === serverMessageId)
                                        ? { ...m, content, reasoning_content: reasoning || undefined }
                                        : m
                                )
                            )
                        })
                    }, MIN_UPDATE_INTERVAL - timeSinceLastUpdate)
                }
            }

            const run = async () => {
                try {
                    const res = await fetch("/api/playground/chat", {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            Authorization: getAuthHeader() || ""
                        },
                        body: JSON.stringify({
                            conversation_id: conversationId,
                            model: model,
                            message: userContent,
                            user_message_id: lastUserMessage.id,
                            parent_message_id: userParentId || null,
                            ...options.config
                        }),
                        signal: controller.signal
                    })

                    if (!res.ok) {
                        const text = await res.text()
                        throw new Error(text || res.statusText)
                    }

                    serverMessageId = res.headers.get("X-Message-ID")
                    serverGenerationId = res.headers.get("X-Generation-ID")

                    if (!res.body) throw new Error("No response body")

                    const reader = res.body.getReader()
                    const decoder = new TextDecoder()
                    let buffer = ""
                    let currentEvent: string | null = null

                    while (true) {
                        const { value, done } = await reader.read()
                        if (done) break

                        buffer += decoder.decode(value, { stream: true })
                        const lines = buffer.split("\n")
                        buffer = lines.pop() || ""

                        for (const line of lines) {
                            const trimmed = line.trim()
                            if (!trimmed) continue

                            if (trimmed.startsWith("event:")) {
                                currentEvent = trimmed.slice(6).trim()
                                continue
                            }

                            if (!trimmed.startsWith("data: ")) continue

                            const dataStr = trimmed.slice(6)

                            if (currentEvent === "error") {
                                currentEvent = null
                                try {
                                    const data = JSON.parse(dataStr)
                                    const msg = data?.error?.message || "Streaming error"
                                    throw new Error(msg)
                                } catch (err) {
                                    throw err instanceof Error ? err : new Error(String(err))
                                }
                            }

                            currentEvent = null

                            if (dataStr === "[DONE]") {
                                updateMessage(accumulatedContent, accumulatedReasoning, true, true)
                                break
                            }

                            try {
                                const data = JSON.parse(dataStr)
                                const delta = data.choices?.[0]?.delta
                                const content = delta?.content
                                const reasoning = delta?.reasoning_content

                                let hasUpdate = false

                                if (reasoning) {
                                    accumulatedReasoning += reasoning
                                    hasUpdate = true
                                }
                                if (content) {
                                    accumulatedContent += content
                                    hasUpdate = true
                                }

                                if (hasUpdate) {
                                    updateMessage(accumulatedContent, accumulatedReasoning)
                                }
                            } catch {
                                // ignore parse errors
                            }
                        }
                    }
                    updateMessage(accumulatedContent, accumulatedReasoning, true, true)
                } catch (err: any) {
                    if (err.name === "AbortError") {
                        updateMessage(accumulatedContent, accumulatedReasoning, true, true)
                    } else {
                        console.error("Chat Retry Error:", err)
                        setError(err)
                        toast.error(err.message || "Failed to retry message")
                        // Remove the failed assistant message from the list
                        setMessages(prev =>
                            prev.filter(m => m.id !== assistantMsg.id && m.id !== serverMessageId)
                        )
                    }
                }
            }

            return run()
        })

        try {
            await Promise.allSettled(tasks)
        } finally {
            setIsLoading(false)
            abortControllersRef.current = []
        }
    }, [messages, isLoading, lastMessageIsUser, conversationId, updateInterval])

    // Regenerate: create a new sibling response for the last assistant message's parent
    // This finds the user message that the last assistant replied to and generates a new response
    const handleRegenerate = useCallback(async (options?: { models: string[]; config: any }) => {
        if (isLoading) return

        if (!options?.models || options.models.length === 0) {
            toast.error("Please select a model first")
            return
        }

        const models = options.models

        // Find the last assistant message
        let lastAssistantIdx = -1
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role === 'assistant') {
                lastAssistantIdx = i
                break
            }
        }

        if (lastAssistantIdx === -1) {
            toast.error("No assistant message to regenerate")
            return
        }

        const lastAssistant = messages[lastAssistantIdx]
        const userParentId = lastAssistant.parent_id  // The user message this assistant replied to

        // Find the user message
        const userMessage = messages.find(m => m.id === userParentId)
        if (!userMessage) {
            toast.error("Cannot find parent user message")
            return
        }

        const userContent = userMessage.content

        setError(null)
        setIsLoading(true)

        const assistantMsgs = models.map(model => ({
            id: crypto.randomUUID(),
            role: "assistant" as const,
            content: "",
            model_id: model,
            parent_id: userParentId,
            created_at: new Date()
        }))

        // Add new assistant messages (siblings)
        setMessages(prev => [...prev, ...assistantMsgs])

        const tasks = assistantMsgs.map((assistantMsg, idx) => {
            const model = models[idx]
            const controller = new AbortController()
            abortControllersRef.current.push(controller)

            let accumulatedContent = ""
            let accumulatedReasoning = ""
            let serverMessageId: string | null = null
            let serverGenerationId: string | null = null

            const MIN_UPDATE_INTERVAL = updateInterval
            let lastUpdateTime = 0
            let isFirstUpdate = true
            let pendingTimeout: ReturnType<typeof setTimeout> | null = null

            const updateMessage = (content: string, reasoning: string, force = false, includeIds = false) => {
                const now = Date.now()
                const timeSinceLastUpdate = now - lastUpdateTime

                if (pendingTimeout) {
                    clearTimeout(pendingTimeout)
                    pendingTimeout = null
                }

                const getUpdate = () => {
                    const update: any = { content, reasoning_content: reasoning || undefined }
                    if (includeIds) {
                        if (serverMessageId) update.id = serverMessageId
                        if (serverGenerationId) update.generation_id = serverGenerationId
                    }
                    return update
                }

                if (isFirstUpdate || force) {
                    isFirstUpdate = false
                    lastUpdateTime = now
                    const updateObj = getUpdate()
                    flushSync(() => {
                        setMessages(prev =>
                            prev.map(m =>
                                (m.id === assistantMsg.id || m.id === serverMessageId)
                                    ? { ...m, ...updateObj }
                                    : m
                            )
                        )
                    })
                    return
                }

                if (timeSinceLastUpdate >= MIN_UPDATE_INTERVAL) {
                    lastUpdateTime = now
                    flushSync(() => {
                        setMessages(prev =>
                            prev.map(m =>
                                (m.id === assistantMsg.id || m.id === serverMessageId)
                                    ? { ...m, ...getUpdate() }
                                    : m
                            )
                        )
                    })
                } else {
                    pendingTimeout = setTimeout(() => {
                        lastUpdateTime = Date.now()
                        flushSync(() => {
                            setMessages(prev =>
                                prev.map(m =>
                                    (m.id === assistantMsg.id || m.id === serverMessageId)
                                        ? { ...m, content, reasoning_content: reasoning || undefined }
                                        : m
                                )
                            )
                        })
                    }, MIN_UPDATE_INTERVAL - timeSinceLastUpdate)
                }
            }

            const run = async () => {
                try {
                    const res = await fetch("/api/playground/chat", {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            Authorization: getAuthHeader() || ""
                        },
                        body: JSON.stringify({
                            conversation_id: conversationId,
                            model: model,
                            message: userContent,
                            user_message_id: userMessage.id,
                            parent_message_id: userMessage.parent_id || null,
                            ...options.config
                        }),
                        signal: controller.signal
                    })

                    if (!res.ok) {
                        const text = await res.text()
                        throw new Error(text || res.statusText)
                    }

                    serverMessageId = res.headers.get("X-Message-ID")
                    serverGenerationId = res.headers.get("X-Generation-ID")

                    if (!res.body) throw new Error("No response body")

                    const reader = res.body.getReader()
                    const decoder = new TextDecoder()
                    let buffer = ""
                    let currentEvent: string | null = null

                    while (true) {
                        const { value, done } = await reader.read()
                        if (done) break

                        buffer += decoder.decode(value, { stream: true })
                        const lines = buffer.split("\n")
                        buffer = lines.pop() || ""

                        for (const line of lines) {
                            const trimmed = line.trim()
                            if (!trimmed) continue

                            if (trimmed.startsWith("event:")) {
                                currentEvent = trimmed.slice(6).trim()
                                continue
                            }

                            if (!trimmed.startsWith("data: ")) continue

                            const dataStr = trimmed.slice(6)

                            if (currentEvent === "error") {
                                currentEvent = null
                                try {
                                    const data = JSON.parse(dataStr)
                                    const msg = data?.error?.message || "Streaming error"
                                    throw new Error(msg)
                                } catch (err) {
                                    throw err instanceof Error ? err : new Error(String(err))
                                }
                            }

                            currentEvent = null

                            if (dataStr === "[DONE]") {
                                updateMessage(accumulatedContent, accumulatedReasoning, true, true)
                                break
                            }

                            try {
                                const data = JSON.parse(dataStr)
                                const delta = data.choices?.[0]?.delta
                                const content = delta?.content
                                const reasoning = delta?.reasoning_content

                                let hasUpdate = false

                                if (reasoning) {
                                    accumulatedReasoning += reasoning
                                    hasUpdate = true
                                }
                                if (content) {
                                    accumulatedContent += content
                                    hasUpdate = true
                                }

                                if (hasUpdate) {
                                    updateMessage(accumulatedContent, accumulatedReasoning)
                                }
                            } catch {
                                // ignore parse errors
                            }
                        }
                    }
                    updateMessage(accumulatedContent, accumulatedReasoning, true, true)
                } catch (err: any) {
                    if (err.name === "AbortError") {
                        updateMessage(accumulatedContent, accumulatedReasoning, true, true)
                    } else {
                        console.error("Chat Regenerate Error:", err)
                        setError(err)
                        toast.error(err.message || "Failed to regenerate message")
                        // Remove the failed assistant message from the list
                        setMessages(prev =>
                            prev.filter(m => m.id !== assistantMsg.id && m.id !== serverMessageId)
                        )
                    }
                }
            }

            return run()
        })

        try {
            await Promise.allSettled(tasks)
        } finally {
            setIsLoading(false)
            abortControllersRef.current = []
        }
    }, [messages, isLoading, conversationId, updateInterval])

    return {
        messages,
        handleSubmit,
        handleRetry,
        handleRegenerate,
        isLoading,
        setMessages,
        error,
        stop,
        lastMessageIsUser
    }
}
