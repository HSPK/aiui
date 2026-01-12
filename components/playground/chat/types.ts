// Chat module types

export type Message = {
    id: string
    role: "user" | "assistant" | "system"
    content: string
    reasoning_content?: string
    model_id?: string
    parent_id?: string
    created_at?: Date | string
    createdAt?: Date | string
    generation_id?: string
    rating?: string
    feedback?: string
}

export type StreamConfig = {
    conversationId?: string
    model: string
    message: string
    userMessageId: string
    parentMessageId?: string | null
    additionalConfig?: Record<string, any>
}

export type StreamCallbacks = {
    onContent: (content: string, reasoning: string) => void
    onComplete: (messageId: string | null, generationId: string | null) => void
    onError: (error: Error) => void
}

export type ChatOptions = {
    models: string[]
    config?: Record<string, any> // Deprecated: use getModelConfig
    getModelConfig?: (modelId: string) => Record<string, any> // Per-model config
    contextMessageId?: string
}

export type MessageUpdate = {
    content: string
    reasoning_content?: string
    id?: string
    generation_id?: string
}
