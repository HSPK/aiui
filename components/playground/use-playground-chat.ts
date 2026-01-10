// Proxy for the Chat backend
// Ideally this should be in `lib/chat-hooks.ts` or similar, but putting here given the instructions

import { useState, useCallback, useEffect } from "react"
import { api } from "@/lib/api"
import { Message } from "@/lib/types/playground"
import { toast } from "sonner"

export function usePlaygroundChat({
    initialMessages = [],
    conversationId,
    onConversationCreated,
}: {
    initialMessages?: any[],
    conversationId?: string,
    onConversationCreated?: (id: string, groupId?: string) => void
}) {
    const [messages, setMessages] = useState<any[]>(initialMessages)
    const [input, setInput] = useState("")
    const [isLoading, setIsLoading] = useState(false)

    // Sync initial messages
    useEffect(() => {
        if (initialMessages && initialMessages.length > 0) {
            setMessages(initialMessages)
        }
    }, [initialMessages])

    const handleSubmit = async (e?: React.FormEvent, options?: { models: string[], config: any }) => {
        e?.preventDefault()
        if (!input.trim() || isLoading) return
        if (!options?.models || options.models.length === 0) {
            toast.error("Please select a model first")
            return
        }

        const userMsg = {
            id: crypto.randomUUID(),
            role: "user",
            content: input,
            created_at: new Date().toISOString()
        }

        const previousInput = input

        // Optimistic update
        setMessages(prev => [...prev, userMsg])
        setInput("")
        setIsLoading(true)

        try {
            // Handle Multiple Models (Comparison) or Single
            const groupId = options.models.length > 1 ? crypto.randomUUID() : undefined
            const currentConvId = conversationId

            const promises = options.models.map(async model => {
                const res = await api.playgroundChat({
                    message: userMsg.content,
                    conversation_id: currentConvId,
                    group_id: groupId,
                    model: model,
                    ...options.config
                })

                // Create a placeholder message for this model if standard flow
                // But we act after all promises? No, we should probably start showing them ASAP.
                // Current logic waits for all. Let's keep it simple and accumulate text.

                const reader = res.body?.getReader()
                const decoder = new TextDecoder()
                let fullText = ""

                if (!reader) return { model, res: "" }

                try {
                    while (true) {
                        const { done, value } = await reader.read()
                        if (done) break

                        const chunk = decoder.decode(value, { stream: true })
                        const lines = chunk.split('\n')

                        for (const line of lines) {
                            if (line.startsWith('event: error')) {
                                // The NEXT line should be data: containing the error
                                continue
                            }
                            if (line.startsWith('data: ')) {
                                const dataStr = line.slice(6)
                                if (dataStr.trim() === '[DONE]') continue

                                let data;
                                try {
                                    data = JSON.parse(dataStr)
                                } catch (e) {
                                    console.warn("Failed to parse SSE data JSON", dataStr)
                                    continue
                                }

                                if (data.error) {
                                    throw new Error(data.error.message || "Stream Error")
                                }

                                // Normal data
                                if (typeof data === 'string') {
                                    fullText += data
                                } else if (data.content) {
                                    fullText += data.content
                                } else if (data.delta?.content) {
                                    fullText += data.delta.content
                                } else if (data.response) {
                                    fullText += data.response
                                } else {
                                    fullText += JSON.stringify(data)
                                }
                            }
                        }
                    }
                } catch (e) {
                    throw e
                }

                return { model, res: fullText }
            })

            const results = await Promise.all(promises)

            // Handle Results
            const newMessages = results.map(r => {
                return {
                    id: crypto.randomUUID(),
                    role: "assistant",
                    content: r.res,
                    model: r.model
                }
            })

            setMessages(prev => [...prev, ...newMessages])

        } catch (err: any) {
            console.error(err)
            toast.error(err.message || "Failed to send message")

            // Restore state on error
            setMessages(prev => prev.filter(m => m.id !== userMsg.id))
            setInput(previousInput)
        } finally {
            setIsLoading(false)
        }
    }

    return {
        messages,
        input,
        setInput,
        handleInputChange: (e: any) => setInput(e.target.value),
        handleSubmit,
        isLoading,
        setMessages
    }
}
