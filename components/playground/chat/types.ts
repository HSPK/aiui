// Chat module types

import type { MessageContent } from "@/lib/schemas/content"

export type { MessageContent } from "@/lib/schemas/content"

export type Message = {
    id: string
    role: "user" | "assistant" | "system"
    /** Plain string for text-only turns; array for multimodal
     *  (text + image_url + file parts). Same shape as the wire format,
     *  so persistence and rendering round-trip without translation. */
    content: MessageContent
    reasoning_content?: string
    model_id?: string
    parent_id?: string
    created_at?: Date | string
    createdAt?: Date | string
    generation_id?: string
    rating?: string
    feedback?: string
    /** When set, this assistant slot represents a failed generation.
     *  The chat UI renders it as an inline error card under the user
     *  message and shows a retry button instead of normal content. */
    error?: string
}

export type StreamConfig = {
    conversationId?: string
    model: string
    /** Multimodal — string or content-part array. Forwarded verbatim
     *  to /api/playground/chat as `content`. */
    content: MessageContent
    userMessageId: string
    /** Upsert id for the assistant slot (set on retry). */
    assistantMessageId?: string
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
