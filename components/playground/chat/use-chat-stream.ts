// Chat Stream Hook - orchestrates streaming for multiple models

import { useRef, useCallback } from "react"
import { toast } from "sonner"
import { StreamClient } from "./stream-client"
import { ThrottledUpdater } from "./throttled-updater"
import type { Message, MessageContent, StreamConfig } from "./types"

type SetMessages = React.Dispatch<React.SetStateAction<Message[]>>
type ModelConfig = StreamConfig['additionalConfig']

type StreamParams = {
    userMessageId: string
    userContent: MessageContent
    parentMessageId?: string
    models: string[]
    config?: ModelConfig
    getModelConfig?: (modelId: string) => ModelConfig
    enabledMcpServerIds?: string[]
}

export function useChatStream(
    conversationId: string | undefined,
    setMessages: SetMessages,
    updateInterval: number = 100
) {
    const clientsRef = useRef<StreamClient[]>([])

    const stopAll = useCallback(() => {
        clientsRef.current.forEach(client => client.abort())
        clientsRef.current = []
    }, [])

    const streamOne = useCallback(async (params: {
        userMessageId: string
        userContent: MessageContent
        parentMessageId?: string
        assistantMsgId: string
        model: string
        modelConfig?: ModelConfig
        enabledMcpServerIds?: string[]
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
                    content: params.userContent,
                    userMessageId: params.userMessageId,
                    // Upsert key — same id across retries replaces the row server-side.
                    assistantMessageId: params.assistantMsgId,
                    parentMessageId: params.parentMessageId,
                    enabledMcpServerIds: params.enabledMcpServerIds,
                    additionalConfig: params.modelConfig
                },
                {
                    onContent: (content, reasoning) => {
                        updater.appendContent(
                            content.slice(updater.getContent().content.length),
                            reasoning.slice(updater.getContent().reasoning.length)
                        )
                    },
                    onToolEvent: (ev) => {
                        if (ev.type === "tool_call_delta") {
                            updater.applyToolCallDelta(ev.call)
                        } else if (ev.type === "tool_result") {
                            updater.applyToolResult(ev.result)
                        } else if (ev.type === "tool_error") {
                            const where = ev.serverName ? ` (${ev.serverName})` : ""
                            toast.error(`MCP${where}: ${ev.message}`)
                        }
                    },
                    onComplete: (messageId, generationId) => {
                        updater.setServerIds(messageId, generationId)
                    },
                    onError: (error) => {
                        console.error(`Chat Error [${params.model}]:`, error)
                    }
                }
            )
            updater.flush(true)
        } catch (err) {
            if (err instanceof Error && err.name === "AbortError") {
                updater.flush(true)
            } else {
                const message = err instanceof Error ? err.message : String(err)
                const serverId = updater.getServerMessageId()
                const serverGenId = updater.getServerGenerationId()
                setMessages(prev =>
                    prev.map(m => {
                        if (m.id !== params.assistantMsgId && m.id !== serverId) return m
                        return {
                            ...m,
                            id: serverId ?? m.id,
                            generation_id: serverGenId ?? m.generation_id,
                            error: message || "Failed to generate response",
                        }
                    })
                )
            }
        } finally {
            updater.dispose()
        }
    }, [conversationId, setMessages, updateInterval])

    /** Stream responses for multiple models in parallel. */
    const streamMultiple = useCallback(async (params: StreamParams): Promise<void> => {
        const { userMessageId, userContent, parentMessageId, models, config, getModelConfig, enabledMcpServerIds } = params

        const assistantMsgs: Message[] = models.map(model => ({
            id: crypto.randomUUID(),
            role: "assistant" as const,
            content: "",
            model_id: model,
            parent_id: userMessageId,
            created_at: new Date()
        }))

        setMessages(prev => [...prev, ...assistantMsgs])

        const tasks = assistantMsgs.map((assistantMsg, idx) => {
            const model = models[idx]
            const modelConfig = getModelConfig ? getModelConfig(model) : config
            return streamOne({
                userMessageId,
                userContent,
                parentMessageId,
                assistantMsgId: assistantMsg.id,
                model,
                modelConfig,
                enabledMcpServerIds,
            })
        })

        await Promise.allSettled(tasks)
        clientsRef.current = []
    }, [setMessages, streamOne])

    /**
     * Reset the failed slot in place and re-stream just that model.
     * The same id is reused so the server upserts the same row.
     */
    const retryFailedMessage = useCallback(async (
        failedMessage: Message,
        userContent: MessageContent,
        getModelConfig?: (modelId: string) => ModelConfig,
        enabledMcpServerIds?: string[],
    ): Promise<void> => {
        if (!failedMessage.model_id || !failedMessage.parent_id) return

        setMessages(prev => prev.map(m =>
            m.id === failedMessage.id
                ? {
                    ...m,
                    content: "",
                    reasoning_content: undefined,
                    error: undefined,
                    generation_id: undefined,
                    tool_calls: undefined,
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
                modelConfig,
                enabledMcpServerIds,
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
