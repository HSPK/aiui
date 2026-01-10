// Proxy for the Chat backend
// Ideally this should be in `lib/chat-hooks.ts` or similar, but putting here given the instructions

import { useEffect, useState, useRef, useCallback } from "react"
import { toast } from "sonner"
import { getAuthHeader } from "@/lib/api"

export type Message = {
    id: string
    role: "user" | "assistant" | "system"
    content: string
    createdAt?: Date
}

export function usePlaygroundChat({
    initialMessages = [],
    conversationId,
    onConversationCreated,
}: {
    initialMessages?: any[],
    conversationId?: string,
    onConversationCreated?: (id: string, groupId?: string) => void
}) {
    const [messages, setMessages] = useState<Message[]>([])
    const [input, setInput] = useState("")
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<Error | null>(null)

    // To handle aborts
    const abortControllerRef = useRef<AbortController | null>(null)
    const initializedRef = useRef<string | null>(null)

    // Sync initial messages
    useEffect(() => {
        // Prevent re-syncing if we're in the middle of a generation or if we've already synced this conversation
        // This breaks the update cycle between store -> initialMessages -> localMessages -> store
        if (isLoading) return

        // Simple equality check or ID check to avoid unnecessary updates
        // If the conversation ID changed, we ALWAYS sync.
        // If ID is same, we only sync if we haven't touched it, OR if the message count differs significantly (external update)

        const currentId = conversationId || "new"

        // If we switched conversations, force update
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
            setIsLoading(false)
        }
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
            createdAt: new Date()
        }

        // Placeholder assistant message
        const assistantMsgId = crypto.randomUUID()
        const assistantMsg: Message = {
            id: assistantMsgId,
            role: "assistant",
            content: "",
            createdAt: new Date()
        }

        setMessages(prev => [...prev, userMsg, assistantMsg])

        // Abort controller
        abortControllerRef.current = new AbortController()

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
                        if (!trimmed || !trimmed.startsWith("data: ")) continue

                        const dataStr = trimmed.slice(6) // Remove "data: "
                        if (dataStr === "[DONE]") {
                            done = true
                            break
                        }

                        try {
                            const data = JSON.parse(dataStr)

                            // Handle standard OpenAI chunk format: choices[0].delta.content
                            const content = data.choices?.[0]?.delta?.content

                            if (content) {
                                setMessages(prev => {
                                    return prev.map(m => {
                                        if (m.id === assistantMsgId) {
                                            // Ensure we are appending to a string
                                            const currentContent = typeof m.content === 'string' ? m.content : ""
                                            return { ...m, content: currentContent + content }
                                        }
                                        return m
                                    })
                                })
                                // Yield to main thread to allow React to render (fix for "all at once" streaming)
                                await new Promise(resolve => setTimeout(resolve, 10));
                            }
                        } catch (e) {
                            // ignore parse errors for non-json data lines if any
                        }
                    }
                }
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
            setIsLoading(false)
            abortControllerRef.current = null
        }
    }

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
