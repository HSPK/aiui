// Stream Client - handles SSE streaming from chat API

import { SSEParser } from "./stream-parser"
import type { StreamConfig, StreamCallbacks } from "./types"

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "/api"

export class StreamClient {
    private abortController: AbortController | null = null

    /**
     * Start streaming chat response
     */
    async stream(config: StreamConfig, callbacks: StreamCallbacks): Promise<void> {
        this.abortController = new AbortController()
        const parser = new SSEParser()

        let reader: ReadableStreamDefaultReader<Uint8Array> | null = null

        try {
            const res = await fetch(`${API_BASE}/playground/chat`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({
                    conversation_id: config.conversationId,
                    model: config.model,
                    content: config.content,
                    user_message_id: config.userMessageId,
                    assistant_message_id: config.assistantMessageId,
                    parent_message_id: config.parentMessageId ?? null,
                    enabled_mcp_server_ids: config.enabledMcpServerIds && config.enabledMcpServerIds.length > 0
                        ? config.enabledMcpServerIds
                        : undefined,
                    ...config.additionalConfig
                }),
                signal: this.abortController.signal
            })

            // Read header IDs before any potential throw so the FE
            // placeholder picks up the server's assistant id and can
            // retry on the same row.
            const messageId = res.headers.get("X-Message-ID")
            const generationId = res.headers.get("X-Generation-ID")
            if (messageId || generationId) callbacks.onComplete(messageId, generationId)

            if (!res.ok) {
                const text = await res.text()
                throw new Error(text || res.statusText)
            }

            if (!res.body) {
                throw new Error("No response body")
            }

            reader = res.body.getReader()
            const decoder = new TextDecoder()

            while (true) {
                const { value, done } = await reader.read()
                if (done) break

                const chunk = decoder.decode(value, { stream: true })
                const events = parser.parse(chunk)

                for (const event of events) {
                    switch (event.type) {
                        case 'content':
                            // Emit deltas directly — the downstream
                            // ThrottledUpdater accumulates. Sending the
                            // accumulated string here used to force a
                            // re-slice in the hook (double accumulation).
                            callbacks.onContent(event.content, event.reasoning || "")
                            break

                        case 'message_meta':
                            // Per-round id update from the orchestrator —
                            // headers are sent before the gateway logId
                            // exists, so this is the only path. Latest
                            // wins (final round's gen id is what the
                            // user-visible message points at).
                            callbacks.onComplete(
                                event.messageId ?? null,
                                event.generationId ?? null,
                            )
                            break

                        case 'tool_call_delta':
                            callbacks.onToolEvent({ type: 'tool_call_delta', call: event.call })
                            break

                        case 'tool_result':
                            callbacks.onToolEvent({ type: 'tool_result', result: event.result })
                            break

                        case 'tool_error':
                            callbacks.onToolEvent({
                                type: 'tool_error',
                                message: event.message,
                                serverName: event.serverName,
                            })
                            break

                        case 'error':
                            throw new Error(event.message)

                        case 'done':
                            // Final update handled by caller
                            break
                    }
                }
            }
        } catch (err: any) {
            if (err.name === "AbortError") {
                // Aborted - not an error, just flush current content
                return
            }
            callbacks.onError(err)
            throw err
        } finally {
            // Always release the stream lock so the underlying network
            // connection can be reclaimed. Without this, a mid-stream
            // throw (e.g. `case 'error'`) leaves the reader locked and
            // the connection held until GC. cancel() is fire-and-forget;
            // ignore errors (already-closed / aborted streams reject).
            if (reader) {
                try { await reader.cancel() } catch { /* ignore */ }
                try { reader.releaseLock() } catch { /* ignore */ }
            }
        }
    }

    /**
     * Abort the current stream
     */
    abort() {
        this.abortController?.abort()
        this.abortController = null
    }

    /**
     * Get the abort controller for external management
     */
    getController(): AbortController | null {
        return this.abortController
    }
}
