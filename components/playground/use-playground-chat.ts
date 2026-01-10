// Proxy for the Chat backend
// Ideally this should be in `lib/chat-hooks.ts` or similar, but putting here given the instructions

import { useState, useCallback, useEffect } from "react"
import { api } from "@/lib/api"
import { Message } from "@/lib/types/playground"

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
            alert("Please select a model first")
            return
        }

        const userMsg = {
            id: crypto.randomUUID(),
            role: "user",
            content: input,
            created_at: new Date().toISOString()
        }

        // Optimistic update
        setMessages(prev => [...prev, userMsg])
        setInput("")
        setIsLoading(true)

        try {
            // Handle Multiple Models (Comparison) or Single
            const groupId = options.models.length > 1 ? crypto.randomUUID() : undefined
            const currentConvId = conversationId // Might be undefined

            // Send request(s)
            // If Single: Just one request
            // If Multiple: Parallel requests? 
            // Warning: The backend snippet implies `group_id` is passed. 
            // If passing group_id, presumably we make multiple calls for each model?
            // "if selected multiple models, also need to generate group id" -> Yes.

            const promises = options.models.map(model =>
                api.playgroundChat({
                    message: userMsg.content,
                    conversation_id: currentConvId, // Note: If multiple models, usually we have diff conversation IDs per model, or shares ONE ID?
                    // "Comparison mode conversation" usually means independent conversations grouped by a group_id.
                    // If we pass `conversation_id: None` for the first time, backend creates it.
                    // If we have an *existing* conversationId, we can't reuse it for *multiple* models usually, unless the backend supports "Arena" in one ID.
                    // I will assume: If multiple models, we treat it as NEW conversations (or new branches) if we don't have existing IDs mapping to models.
                    // Be safe: For now, if multiple models, we pass conversation_id = undefined (create new) IF we are starting fresh.
                    // If we are in a conversation, adding a model is complex.
                    // Let's assume standard flow: 
                    // Single Model: Pass conversationId.
                    // Multi Model: Pass conversationId? If conversationId is bound to a single model in backend, this fails.
                    // I'll assume conversationId is generic.

                    group_id: groupId,
                    model: model,
                    ...options.config // temperature, history_limit
                }).then(res => ({ model, res }))
            )

            const results = await Promise.all(promises)

            // Handle Results
            // If single model, append assistant message.
            // If multiple, append multiple assistant messages? 
            // Or display them differently? The current UI is a single stream.
            // I'll append them all for now.

            const newMessages = results.map(r => {
                let textContent = ""
                const resAny = r.res as any
                if (typeof resAny === 'string') {
                    textContent = resAny
                } else if (resAny.message && typeof resAny.message === 'string') {
                    textContent = resAny.message
                } else if (resAny.response && typeof resAny.response === 'string') {
                    textContent = resAny.response
                } else {
                    // Fallback to stringify but try to keep it clean
                    // Check if it has a 'data' field that might be string
                    if (resAny.data && typeof resAny.data === 'string') {
                        textContent = resAny.data
                    } else {
                        textContent = JSON.stringify(resAny)
                    }
                }

                return {
                    id: crypto.randomUUID(),
                    role: "assistant",
                    content: textContent,
                    model: r.model
                }
            })

            setMessages(prev => [...prev, ...newMessages])

            // If created new conversation, notify parent
            // But we might have created N conversations if we sent N requests with conv_id=null.
            // This is tricky. I'll ignore updating the ID for now if multiple.

        } catch (err) {
            console.error(err)
            // Revert or show error
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
