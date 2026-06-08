// Chat module types

import type { MessageContent } from "@/lib/schemas/content"

export type { MessageContent } from "@/lib/schemas/content"

export type Message = {
    id: string
    role: "user" | "assistant" | "system" | "tool"
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
    /** Tool calls the model made on this turn, paired with results
     *  (filled in as MCP execution completes). Rendered as collapsible
     *  cards inside the assistant bubble. */
    tool_calls?: AssembledToolCall[]
}

export type AssembledToolCall = {
    id: string
    name: string
    /** JSON-string args, exactly as the model emitted (we don't parse
     *  for fidelity; the renderer can JSON.parse for pretty-display). */
    arguments: string
    /** Human-friendly origin label — server name surfaced by the
     *  gateway/playground service. */
    source?: string
    result?: {
        content: string
        is_error: boolean
        source?: string
    }
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
    /** MCP server ids enabled for this turn. Forwarded as
     *  `enabled_mcp_server_ids` and triggers the server-side tool
     *  execution loop when non-empty. */
    enabledMcpServerIds?: string[]
    additionalConfig?: Record<string, any>
}

export type ToolEvent =
    | {
        type: "tool_call_delta"
        call: { index: number; id?: string; name?: string; argumentsDelta?: string }
    }
    | {
        type: "tool_result"
        result: { call_id: string; name: string; content: string; is_error: boolean; source?: string }
    }
    | { type: "tool_error"; message: string; serverName?: string }

export type StreamCallbacks = {
    onContent: (content: string, reasoning: string) => void
    onToolEvent: (event: ToolEvent) => void
    onComplete: (messageId: string | null, generationId: string | null) => void
    onError: (error: Error) => void
}

export type ChatOptions = {
    models: string[]
    config?: Record<string, any> // Deprecated: use getModelConfig
    getModelConfig?: (modelId: string) => Record<string, any> // Per-model config
    contextMessageId?: string
    /** MCP server ids enabled for this turn (chat-input picker). */
    enabledMcpServerIds?: string[]
}

export type MessageUpdate = {
    content: string
    reasoning_content?: string
    id?: string
    generation_id?: string
    tool_calls?: AssembledToolCall[]
}
