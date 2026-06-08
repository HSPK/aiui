// SSE Stream Parser - handles parsing of Server-Sent Events

export type ParsedEvent =
    | { type: 'content'; content: string; reasoning?: string }
    | {
        type: 'tool_call_delta'
        call: { index: number; id?: string; name?: string; argumentsDelta?: string }
    }
    | {
        type: 'tool_result'
        result: { call_id: string; name: string; content: string; is_error: boolean; source?: string }
    }
    | { type: 'tool_error'; message: string; serverName?: string }
    | { type: 'message_meta'; messageId?: string; generationId?: string }
    | { type: 'done' }
    | { type: 'error'; message: string }

export class SSEParser {
    private buffer = ""
    private currentEvent: string | null = null

    /**
     * Parse incoming SSE data chunk
     * @param chunk - Raw text chunk from stream
     * @returns Array of parsed events
     */
    parse(chunk: string): ParsedEvent[] {
        const events: ParsedEvent[] = []

        this.buffer += chunk
        const lines = this.buffer.split("\n")
        this.buffer = lines.pop() || ""

        for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed) {
                // Blank line resets the event-type accumulator (SSE
                // record terminator). Without this, an `event:` line
                // would stick across unrelated records.
                this.currentEvent = null
                continue
            }

            // Handle event type line
            if (trimmed.startsWith("event:")) {
                this.currentEvent = trimmed.slice(6).trim()
                continue
            }

            // Skip non-data lines
            if (!trimmed.startsWith("data: ") && !trimmed.startsWith("data:")) continue
            const dataStr = trimmed.startsWith("data: ") ? trimmed.slice(6) : trimmed.slice(5)

            // Synthetic Loom events surfaced by the playground service
            // for MCP tool execution. These ride on the same SSE channel
            // as the chat-completion chunks so the FE can render result
            // bubbles in real time.
            if (this.currentEvent === "loom_message_meta") {
                this.currentEvent = null
                try {
                    const data = JSON.parse(dataStr)
                    events.push({
                        type: 'message_meta',
                        messageId: typeof data?.message_id === "string" ? data.message_id : undefined,
                        generationId: typeof data?.generation_id === "string" ? data.generation_id : undefined,
                    })
                } catch { /* ignore */ }
                continue
            }
            if (this.currentEvent === "loom_tool_result") {
                this.currentEvent = null
                try {
                    const data = JSON.parse(dataStr)
                    events.push({
                        type: 'tool_result',
                        result: {
                            call_id: String(data?.call_id ?? ""),
                            name: String(data?.name ?? ""),
                            content: String(data?.content ?? ""),
                            is_error: !!data?.is_error,
                            source: typeof data?.source === "string" ? data.source : undefined,
                        },
                    })
                } catch { /* ignore */ }
                continue
            }
            if (this.currentEvent === "loom_tool_error") {
                this.currentEvent = null
                try {
                    const data = JSON.parse(dataStr)
                    events.push({
                        type: 'tool_error',
                        message: String(data?.message ?? "Tool error"),
                        serverName: typeof data?.server_name === "string" ? data.server_name : undefined,
                    })
                } catch { /* ignore */ }
                continue
            }
            if (this.currentEvent === "loom_error" || this.currentEvent === "error") {
                this.currentEvent = null
                try {
                    const data = JSON.parse(dataStr)
                    events.push({
                        type: 'error',
                        message: data?.error?.message || data?.message || "Streaming error"
                    })
                } catch {
                    events.push({ type: 'error', message: "Streaming error" })
                }
                continue
            }

            this.currentEvent = null

            // Handle done signal
            if (dataStr === "[DONE]") {
                events.push({ type: 'done' })
                continue
            }

            // Parse chat-completion chunk: text deltas + tool_call deltas.
            try {
                const data = JSON.parse(dataStr)
                const delta = data.choices?.[0]?.delta
                const content = delta?.content || ""
                const reasoning = delta?.reasoning_content || ""

                if (content || reasoning) {
                    events.push({ type: 'content', content, reasoning })
                }

                const toolCalls = delta?.tool_calls
                if (Array.isArray(toolCalls)) {
                    for (const tc of toolCalls) {
                        events.push({
                            type: 'tool_call_delta',
                            call: {
                                index: typeof tc?.index === "number" ? tc.index : 0,
                                id: typeof tc?.id === "string" ? tc.id : undefined,
                                name: typeof tc?.function?.name === "string" ? tc.function.name : undefined,
                                argumentsDelta:
                                    typeof tc?.function?.arguments === "string"
                                        ? tc.function.arguments
                                        : undefined,
                            },
                        })
                    }
                }
            } catch {
                // Ignore parse errors
            }
        }

        return events
    }

    /**
     * Reset parser state
     */
    reset() {
        this.buffer = ""
        this.currentEvent = null
    }
}
