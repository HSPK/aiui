// Chat Stream Hook - orchestrates streaming for multiple models

import { useRef, useCallback } from "react"
import { StreamClient } from "./stream-client"
import { ThrottledUpdater } from "./throttled-updater"
import type { Message, StreamConfig } from "./types"

type SetMessages = React.Dispatch<React.SetStateAction<Message[]>>
/** Reuses the existing any-typed shape from `StreamConfig` so we don't
 *  introduce additional `any` usage here. */
type ModelConfig = StreamConfig['additionalConfig']

type StreamParams = {
    userMessageId: string
    userContent: string
    parentMessageId?: string
    models: string[]
    config?: ModelConfig // Deprecated: global config fallback
    getModelConfig?: (modelId: string) => ModelConfig // Per-model config
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
     * Stream a single assistant slot. Used both for the initial fan-out
     * inside `streamMultiple` and for per-message retries from the error
     * card — both paths share the same content/error/abort handling.
     */
    const streamOne = useCallback(async (params: {
        userMessageId: string
        userContent: string
        parentMessageId?: string
        assistantMsgId: string
        model: string
        modelConfig?: ModelConfig
    }) => {
        const client = new StreamClient()
        clientsRef.current.push(client)

        const updater = new ThrottledUpdater(
            params.assistantMsgId,
            setMessages,
            updateInterval
        )

        try {
            await client.stream(
                {
                    conversationId,
                    model: params.model,
                    message: params.userContent,
                    userMessageId: params.userMessageId,
                    parentMessageId: params.parentMessageId,
                    additionalConfig: params.modelConfig
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
                        console.error(`Chat Error [${params.model}]:`, error)
                    }
                }
            )
            // Final flush
            updater.flush(true)
        } catch (err) {
            if (err instanceof Error && err.name === "AbortError") {
                // Aborted - flush what we have
                updater.flush(true)
            } else {
                // Mark the placeholder as errored — the UI renders it
                // as an inline error card with its own retry button.
                const message = err instanceof Error ? err.message : String(err)
                setMessages(prev =>
                    prev.map(m =>
                        m.id === params.assistantMsgId
                            ? { ...m, error: message || "Failed to generate response" }
                            : m
                    )
                )
            }
        } finally {
            updater.dispose()
        }
    }, [conversationId, setMessages, updateInterval])

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
            const modelConfig = getModelConfig ? getModelConfig(model) : config
            return streamOne({
                userMessageId,
                userContent,
                parentMessageId,
                assistantMsgId: assistantMsg.id,
                model,
                modelConfig
            })
        })

        await Promise.allSettled(tasks)
        clientsRef.current = []
    }, [setMessages, streamOne])

    /**
     * Retry a single failed assistant slot. Replaces the errored
     * placeholder with a fresh one bound to the same id (so React
     * reuses the DOM node) and streams that single model again. Used
     * by the retry button on the inline error card.
     */
    const retryFailedMessage = useCallback(async (
        failedMessage: Message,
        userContent: string,
        getModelConfig?: (modelId: string) => ModelConfig
    ): Promise<void> => {
        if (!failedMessage.model_id || !failedMessage.parent_id) return

        // Reset the slot: clear error/content, keep the id so the
        // ChatMessage component instance is preserved across the retry.
        setMessages(prev => prev.map(m =>
            m.id === failedMessage.id
                ? {
                    ...m,
                    content: "",
                    reasoning_content: undefined,
                    error: undefined,
                    generation_id: undefined,
                    created_at: new Date()
                }
                : m
        ))

        const modelConfig = getModelConfig ? getModelConfig(failedMessage.model_id) : undefined
        try {
            await streamOne({
                userMessageId: failedMessage.parent_id,
                userContent,
                parentMessageId: failedMessage.parent_id,
                assistantMsgId: failedMessage.id,
                model: failedMessage.model_id,
                modelConfig
            })
        } finally {
            clientsRef.current = []
        }
    }, [setMessages, streamOne])

    return {
        streamMultiple,
        retryFailedMessage,
        stopAll
    }
}
