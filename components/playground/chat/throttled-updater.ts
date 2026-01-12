// Throttled Message Updater - handles batched UI updates during streaming

import { flushSync } from "react-dom"
import type { Message, MessageUpdate } from "./types"

type SetMessages = React.Dispatch<React.SetStateAction<Message[]>>

export class ThrottledUpdater {
    private lastUpdateTime = 0
    private isFirstUpdate = true
    private pendingTimeout: ReturnType<typeof setTimeout> | null = null

    private accumulatedContent = ""
    private accumulatedReasoning = ""
    private serverMessageId: string | null = null
    private serverGenerationId: string | null = null

    constructor(
        private readonly clientMessageId: string,
        private readonly setMessages: SetMessages,
        private readonly minInterval: number = 100
    ) { }

    /**
     * Set server-assigned IDs
     */
    setServerIds(messageId: string | null, generationId: string | null) {
        this.serverMessageId = messageId
        this.serverGenerationId = generationId
    }

    /**
     * Append content and trigger throttled update
     */
    appendContent(content: string, reasoning: string) {
        if (content) this.accumulatedContent += content
        if (reasoning) this.accumulatedReasoning += reasoning
        this.scheduleUpdate(false)
    }

    /**
     * Force immediate update with final content
     */
    flush(includeIds = true) {
        if (this.pendingTimeout) {
            clearTimeout(this.pendingTimeout)
            this.pendingTimeout = null
        }
        this.doUpdate(true, includeIds)
    }

    /**
     * Get current accumulated content
     */
    getContent() {
        return {
            content: this.accumulatedContent,
            reasoning: this.accumulatedReasoning
        }
    }

    /**
     * Clean up resources
     */
    dispose() {
        if (this.pendingTimeout) {
            clearTimeout(this.pendingTimeout)
            this.pendingTimeout = null
        }
    }

    private scheduleUpdate(force: boolean) {
        const now = Date.now()
        const timeSinceLastUpdate = now - this.lastUpdateTime

        if (this.pendingTimeout) {
            clearTimeout(this.pendingTimeout)
            this.pendingTimeout = null
        }

        if (this.isFirstUpdate || force) {
            this.doUpdate(force, false)
            return
        }

        if (timeSinceLastUpdate >= this.minInterval) {
            this.doUpdate(false, false)
        } else {
            this.pendingTimeout = setTimeout(() => {
                this.doUpdate(false, false)
            }, this.minInterval - timeSinceLastUpdate)
        }
    }

    private doUpdate(force: boolean, includeIds: boolean) {
        this.isFirstUpdate = false
        this.lastUpdateTime = Date.now()

        const update: MessageUpdate = {
            content: this.accumulatedContent,
            reasoning_content: this.accumulatedReasoning || undefined
        }

        if (includeIds) {
            if (this.serverMessageId) update.id = this.serverMessageId
            if (this.serverGenerationId) update.generation_id = this.serverGenerationId
        }

        const clientId = this.clientMessageId
        const serverId = this.serverMessageId

        flushSync(() => {
            this.setMessages(prev =>
                prev.map(m =>
                    (m.id === clientId || m.id === serverId)
                        ? { ...m, ...update }
                        : m
                )
            )
        })
    }
}
