// SSE Stream Parser - handles parsing of Server-Sent Events

export type ParsedEvent =
    | { type: 'content'; content: string; reasoning?: string }
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
            if (!trimmed) continue

            // Handle event type line
            if (trimmed.startsWith("event:")) {
                this.currentEvent = trimmed.slice(6).trim()
                continue
            }

            // Skip non-data lines
            if (!trimmed.startsWith("data: ")) continue

            const dataStr = trimmed.slice(6)

            // Handle error event
            if (this.currentEvent === "error") {
                this.currentEvent = null
                try {
                    const data = JSON.parse(dataStr)
                    events.push({
                        type: 'error',
                        message: data?.error?.message || "Streaming error"
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

            // Parse content delta
            try {
                const data = JSON.parse(dataStr)
                const delta = data.choices?.[0]?.delta
                const content = delta?.content || ""
                const reasoning = delta?.reasoning_content || ""

                if (content || reasoning) {
                    events.push({ type: 'content', content, reasoning })
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
