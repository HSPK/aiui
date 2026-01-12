// Stream Client - handles SSE streaming from chat API

import { getAuthHeader } from "@/lib/api"
import { SSEParser } from "./stream-parser"
import type { StreamConfig, StreamCallbacks } from "./types"

// 获取 API 基础路径
const API_BASE = process.env.NEXT_PUBLIC_API_URL || "/api"

export class StreamClient {
    private abortController: AbortController | null = null

    /**
     * Start streaming chat response
     */
    async stream(config: StreamConfig, callbacks: StreamCallbacks): Promise<void> {
        this.abortController = new AbortController()
        const parser = new SSEParser()

        let accumulatedContent = ""
        let accumulatedReasoning = ""

        try {
            const res = await fetch(`${API_BASE}/playground/chat`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: getAuthHeader() || ""
                },
                body: JSON.stringify({
                    conversation_id: config.conversationId,
                    model: config.model,
                    message: config.message,
                    user_message_id: config.userMessageId,
                    parent_message_id: config.parentMessageId ?? null,
                    ...config.additionalConfig
                }),
                signal: this.abortController.signal
            })

            if (!res.ok) {
                const text = await res.text()
                throw new Error(text || res.statusText)
            }

            const messageId = res.headers.get("X-Message-ID")
            const generationId = res.headers.get("X-Generation-ID")

            // Notify about server IDs early
            callbacks.onComplete(messageId, generationId)

            if (!res.body) {
                throw new Error("No response body")
            }

            const reader = res.body.getReader()
            const decoder = new TextDecoder()

            while (true) {
                const { value, done } = await reader.read()
                if (done) break

                const chunk = decoder.decode(value, { stream: true })
                const events = parser.parse(chunk)

                for (const event of events) {
                    switch (event.type) {
                        case 'content':
                            accumulatedContent += event.content
                            accumulatedReasoning += event.reasoning || ""
                            callbacks.onContent(accumulatedContent, accumulatedReasoning)
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
