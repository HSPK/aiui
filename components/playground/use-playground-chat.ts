// Proxy for the Chat backend
// Ideally this should be in `lib/chat-hooks.ts` or similar, but putting here given the instructions

import { useEffect, useState, useRef, useCallback } from "react"
import { toast } from "sonner"
import { getAuthHeader } from "@/lib/api"

export type Message = {
    id: string
    role: "user" | "assistant" | "system"
    content: string
    created_at?: Date | string
    createdAt?: Date | string
}

export function usePlaygroundChat({
    initialMessages = [],
    conversationId,
    onConversationCreated,
    streamOptions = {
        smooth: true,
        delay: 15,
        minChunkSize: 10
    }
}: {
    initialMessages?: any[],
    conversationId?: string,
    onConversationCreated?: (id: string, groupId?: string) => void,
    streamOptions?: {
        smooth?: boolean,
        delay?: number,
        minChunkSize?: number
    }
}) {
    const [messages, setMessages] = useState<Message[]>([])
    const [input, setInput] = useState("")
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<Error | null>(null)

    // Smooth streaming state
    const pendingStreamBufferRef = useRef<string>("")
    const streamIntervalRef = useRef<NodeJS.Timeout | null>(null)
    const isStreamingRef = useRef(false)

    // To handle aborts
    const abortControllerRef = useRef<AbortController | null>(null)
    const initializedRef = useRef<string | null>(null)

    // Cleanup interval on unmount
    useEffect(() => {
        return () => {
            if (streamIntervalRef.current) clearInterval(streamIntervalRef.current)
        }
    }, [])

    const flushStreamBuffer = useCallback((targetMsgId: string) => {
        if (!pendingStreamBufferRef.current) return

        // Dynamic chunk size based on buffer backlog to maintain smoothness
        // If backlog is huge, speed up typing, but avoid "dumping" all at once.
        const backlog = pendingStreamBufferRef.current.length
        let size = streamOptions.minChunkSize || 1

        if (backlog > 200) size = 10     // Very far behind
        else if (backlog > 100) size = 5 // Far behind
        else if (backlog > 30) size = 2  // Slightly behind

        const chunk = pendingStreamBufferRef.current.slice(0, size)
        pendingStreamBufferRef.current = pendingStreamBufferRef.current.slice(size)

        if (chunk) {
            setMessages(prev => prev.map(m => {
                if (m.id === targetMsgId) {
                    const currentContent = typeof m.content === 'string' ? m.content : ""
                    return { ...m, content: currentContent + chunk }
                }
                return m
            }))
        }
    }, [streamOptions.minChunkSize])

    // Sync initial messages
    useEffect(() => {
        if (isLoading) return

        const currentId = conversationId || "new"
        if (initializedRef.current !== currentId) {
            initializedRef.current = currentId
            pendingStreamBufferRef.current = ""
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
        if (streamIntervalRef.current) {
            clearInterval(streamIntervalRef.current)
            streamIntervalRef.current = null
        }
        isStreamingRef.current = false
        setIsLoading(false)
    }, [])


    const handleSubmit = async (e?: React.FormEvent, options?: { models: string[], config: any }) => {
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
            toast.info(`Comparing models is not fully supported in this mode yet. Using ${model}.`)
        }

        const userContent = safeInput
        setInput("")
        setError(null)
        setIsLoading(true)

        // Optimistic user update
        const userMsg: Message = {
            id: crypto.randomUUID(),
            role: "user",
            content: userContent,
            created_at: new Date()
        }

        // Placeholder assistant message
        const assistantMsgId = crypto.randomUUID()
        const assistantMsg: Message = {
            id: assistantMsgId,
            role: "assistant",
            content: "",
            created_at: new Date()
        }

        setMessages(prev => [...prev, userMsg, assistantMsg])

        // Abort controller
        abortControllerRef.current = new AbortController()

        // Start stream consumer
        startStreamConsumer(assistantMsgId)

        try {
            // Use local proxy/rewrite path
            const res = await fetch("/api/playground/chat", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": getAuthHeader() || ""
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
            let done = false
            let buffer = ""
            let currentEvent = "message"
            // To reduce TTFT (Time To First Token), we track the first chunk
            let isFirstChunk = true

            while (!done) {
                const { value, done: doneReading } = await reader.read()
                done = doneReading
                if (value) {
                    const chunk = decoder.decode(value, { stream: true })
                    buffer += chunk

                    const lines = buffer.split("\n")
                    // Keep the last line in buffer if incomplete
                    buffer = lines.pop() || ""

                    for (const line of lines) {
                        const trimmed = line.trim()

                        // Empty line indicates end of event
                        if (!trimmed) {
                            currentEvent = "message"
                            continue
                        }

                        if (trimmed.startsWith("event: ")) {
                            currentEvent = trimmed.slice(7).trim()
                            continue
                        }

                        if (!trimmed.startsWith("data: ")) continue

                        const dataStr = trimmed.slice(6) // Remove "data: "
                        if (dataStr === "[DONE]") {
                            done = true
                            break
                        }

                        // Handle explicit server-side stream errors
                        if (currentEvent === "error") {
                            try {
                                const data = JSON.parse(dataStr)
                                const errMsg = data.error?.message || "Stream error occurred"
                                throw new Error(errMsg)
                            } catch (e) {
                                if (e instanceof Error && e.message !== "Unexpected end of JSON input") {
                                    throw e
                                }
                                // If parse fails, maybe raw string?
                                throw new Error(dataStr || "Stream error occurred")
                            }
                        }

                        try {
                            const data = JSON.parse(dataStr)

                            // Handle standard OpenAI chunk format: choices[0].delta.content
                            const content = data.choices?.[0]?.delta?.content

                            if (content) {
                                // Instead of setting state immediately, we push to buffer
                                pendingStreamBufferRef.current += content

                                // If it's the very first chunk, flush immediately to avoid any delay
                                if (isFirstChunk) {
                                    isFirstChunk = false
                                    flushStreamBuffer(assistantMsgId)
                                }
                            }
                        } catch (e) {
                            // ignore parse errors for non-json data lines if any
                        }
                    }
                }
            }

            // After stream is done, ensure buffer is fully flushed
            while (pendingStreamBufferRef.current.length > 0) {
                flushStreamBuffer(assistantMsgId)
                await new Promise(r => setTimeout(r, streamOptions.delay || 15))
            }

        } catch (err: any) {
            if (err.name === 'AbortError') {
                console.log('Request aborted')
            } else {
                console.error("Chat Error:", err)
                setError(err)
                toast.error(err.message || "Failed to send message")
                setMessages(prev => prev.map(m =>
                    m.id === assistantMsgId ? { ...m, content: "Error: " + (err.message || "Failed to generate response") } : m
                ))
            }
        } finally {
            if (streamIntervalRef.current) {
                clearInterval(streamIntervalRef.current)
                streamIntervalRef.current = null
            }
            setIsLoading(false)
            isStreamingRef.current = false
            abortControllerRef.current = null
        }
    }

    // Start consumption loop when we start loading
    const startStreamConsumer = useCallback((msgId: string) => {
        if (streamIntervalRef.current) clearInterval(streamIntervalRef.current)

        isStreamingRef.current = true
        streamIntervalRef.current = setInterval(() => {
            if (pendingStreamBufferRef.current.length > 0) {
                flushStreamBuffer(msgId)
            } else if (!isStreamingRef.current) {
                // Buffer empty and stream done
                if (streamIntervalRef.current) clearInterval(streamIntervalRef.current)
            }
        }, streamOptions.delay || 15)
    }, [flushStreamBuffer, streamOptions.delay])

    const handleInputChangeCustom = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        setInput(e.target.value)
    }

    return {
        messages,
        input,
        setInput,
        handleInputChange: handleInputChangeCustom,
        handleSubmit,
        isLoading,
        setMessages,
        error,
        stop
    }
}
