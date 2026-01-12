// Chat Stream Hook - orchestrates streaming for multiple models

import { useRef, useCallback } from "react"
import { toast } from "sonner"
import { StreamClient } from "./stream-client"
import { ThrottledUpdater } from "./throttled-updater"
import type { Message, ChatOptions } from "./types"

type SetMessages = React.Dispatch<React.SetStateAction<Message[]>>

type StreamParams = {
    userMessageId: string
    userContent: string
    parentMessageId?: string
    models: string[]
    config?: Record<string, any> // Deprecated: global config fallback
    getModelConfig?: (modelId: string) => Record<string, any> // Per-model config
}

export function useChatStream(
    conversationId: string | undefined,
    setMessages: SetMessages,
    updateInterval: number = 100
) {
    const clientsRef = useRef<StreamClient[]>([])

    /**
     * Stop all active streams
     */
    const stopAll = useCallback(() => {
        clientsRef.current.forEach(client => client.abort())
        clientsRef.current = []
    }, [])

    /**
     * Stream responses for multiple models
     */
    const streamMultiple = useCallback(async (params: StreamParams): Promise<void> => {
        const { userMessageId, userContent, parentMessageId, models, config, getModelConfig } = params

        // Create assistant placeholders
        const assistantMsgs: Message[] = models.map(model => ({
            id: crypto.randomUUID(),
            role: "assistant" as const,
            content: "",
            model_id: model,
            parent_id: userMessageId,
            created_at: new Date()
        }))

        // Add placeholders to messages
        setMessages(prev => [...prev, ...assistantMsgs])

        // Create streaming tasks
        const tasks = assistantMsgs.map((assistantMsg, idx) => {
            const model = models[idx]
            const client = new StreamClient()
            clientsRef.current.push(client)

            const updater = new ThrottledUpdater(
                assistantMsg.id,
                setMessages,
                updateInterval
            )

            // Get per-model config or fallback to global config
            const modelConfig = getModelConfig ? getModelConfig(model) : config

            return (async () => {
                try {
                    await client.stream(
                        {
                            conversationId,
                            model,
                            message: userContent,
                            userMessageId,
                            parentMessageId,
                            additionalConfig: modelConfig
                        },
                        {
                            onContent: (content, reasoning) => {
                                updater.appendContent(
                                    content.slice(updater.getContent().content.length),
                                    reasoning.slice(updater.getContent().reasoning.length)
                                )
                            },
                            onComplete: (messageId, generationId) => {
                                updater.setServerIds(messageId, generationId)
                            },
                            onError: (error) => {
                                console.error(`Chat Error [${model}]:`, error)
                                toast.error(error.message || "Failed to generate response")
                            }
                        }
                    )
                    // Final flush
                    updater.flush(true)
                } catch (err: any) {
                    if (err.name !== "AbortError") {
                        // Remove failed message
                        setMessages(prev =>
                            prev.filter(m => m.id !== assistantMsg.id)
                        )
                    } else {
                        // Aborted - flush what we have
                        updater.flush(true)
                    }
                } finally {
                    updater.dispose()
                }
            })()
        })

        await Promise.allSettled(tasks)
        clientsRef.current = []
    }, [conversationId, setMessages, updateInterval])

    return {
        streamMultiple,
        stopAll
    }
}
