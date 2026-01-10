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
            return initialMessages.map(m => ({
                ...m,
                id: m.id || crypto.randomUUID(),
                role: m.role || "user",
                content: m.content || ""
            }))
        }
        return []
    })

    const [input, setInput] = useState("")
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<Error | null>(null)

    const abortControllerRef = useRef<AbortController | null>(null)
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
        if (abortControllerRef.current) {
            abortControllerRef.current.abort()
            abortControllerRef.current = null
        }
        setIsLoading(false)
    }, [])

    const handleSubmit = async (e?: React.FormEvent, options?: { models: string[]; config: any }) => {
        e?.preventDefault()

        const safeInput = input || ""
        if (!safeInput.trim() && !e) return
        if (isLoading) return

        if (!options?.models || options.models.length === 0) {
            toast.error("Please select a model first")
            return
        }

        const model = options.models[0]
        if (options.models.length > 1) {
            toast.info(`Comparing models is not fully supported yet. Using ${model}.`)
        }

        const userContent = safeInput
        setInput("")
        setError(null)
        setIsLoading(true)

        const userMsg: Message = {
            id: crypto.randomUUID(),
            role: "user",
            content: userContent,
            created_at: new Date()
        }

        const assistantMsgId = crypto.randomUUID()
        const assistantMsg: Message = {
            id: assistantMsgId,
            role: "assistant",
            content: "",
            model_id: model,
            created_at: new Date()
        }

        setMessages(prev => [...prev, userMsg, assistantMsg])

        abortControllerRef.current = new AbortController()

        // Accumulated content for the streaming message
        let accumulatedContent = ""
        let accumulatedReasoning = ""

        // Throttle updates: min interval configurable, but always update first and last
        const MIN_UPDATE_INTERVAL = updateInterval
        let lastUpdateTime = 0
        let isFirstUpdate = true
        let pendingUpdate = false
        let pendingTimeout: ReturnType<typeof setTimeout> | null = null

        const updateMessage = (content: string, reasoning: string, force = false) => {
            const now = Date.now()
            const timeSinceLastUpdate = now - lastUpdateTime

            // Clear any pending timeout
            if (pendingTimeout) {
                clearTimeout(pendingTimeout)
                pendingTimeout = null
            }

            // First update or forced update (for [DONE]) - immediate
            if (isFirstUpdate || force) {
                isFirstUpdate = false
                lastUpdateTime = now
                flushSync(() => {
                    setMessages(prev =>
                        prev.map(m =>
                            m.id === assistantMsgId
                                ? { ...m, content, reasoning_content: reasoning || undefined }
                                : m
                        )
                    )
                })
                return
            }

            // Enough time has passed - update immediately
            if (timeSinceLastUpdate >= MIN_UPDATE_INTERVAL) {
                lastUpdateTime = now
                flushSync(() => {
                    setMessages(prev =>
                        prev.map(m =>
                            m.id === assistantMsgId
                                ? { ...m, content, reasoning_content: reasoning || undefined }
                                : m
                        )
                    )
                })
            } else {
                // Schedule update for later
                pendingUpdate = true
                pendingTimeout = setTimeout(() => {
                    lastUpdateTime = Date.now()
                    pendingUpdate = false
                    flushSync(() => {
                        setMessages(prev =>
                            prev.map(m =>
                                m.id === assistantMsgId
                                    ? { ...m, content, reasoning_content: reasoning || undefined }
                                    : m
                            )
                        )
                    })
                }, MIN_UPDATE_INTERVAL - timeSinceLastUpdate)
            }
        }

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
                    ...options.config
                }),
                signal: abortControllerRef.current.signal
            })

            if (!res.ok) {
                const text = await res.text()
                throw new Error(text || res.statusText)
            }

            if (!res.body) throw new Error("No response body")

            const reader = res.body.getReader()
            const decoder = new TextDecoder()
            let buffer = ""

            while (true) {
                const { value, done } = await reader.read()
                if (done) break

                buffer += decoder.decode(value, { stream: true })
                const lines = buffer.split("\n")
                buffer = lines.pop() || ""

                for (const line of lines) {
                    const trimmed = line.trim()
                    if (!trimmed || !trimmed.startsWith("data: ")) continue

                    const dataStr = trimmed.slice(6)
                    if (dataStr === "[DONE]") {
                        // Force final update when stream ends
                        updateMessage(accumulatedContent, accumulatedReasoning, true)
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

                        // Throttled update
                        if (hasUpdate) {
                            updateMessage(accumulatedContent, accumulatedReasoning)
                        }
                    } catch {
                        // ignore parse errors
                    }
                }
            }
            // Final update after stream ends (in case [DONE] wasn't received)
            updateMessage(accumulatedContent, accumulatedReasoning, true)
        } catch (err: any) {
            if (err.name === "AbortError") {
                console.log("Request aborted")
                // Still update with whatever we have
                updateMessage(accumulatedContent, accumulatedReasoning, true)
            } else {
                console.error("Chat Error:", err)
                setError(err)
                toast.error(err.message || "Failed to send message")
                setMessages(prev =>
                    prev.map(m =>
                        m.id === assistantMsgId
                            ? { ...m, content: "Error: " + (err.message || "Failed to generate response") }
                            : m
                    )
                )
            }
        } finally {
            setIsLoading(false)
            abortControllerRef.current = null
        }
    }

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        setInput(e.target.value)
    }

    return {
        messages,
        input,
        setInput,
        handleInputChange,
        handleSubmit,
        isLoading,
        setMessages,
        error,
        stop
    }
}
