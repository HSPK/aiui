// Throttled Message Updater - handles batched UI updates during streaming
// Optimized: Removed flushSync to allow React to batch updates naturally

import type { Message, MessageUpdate } from "./types"

type SetMessages = React.Dispatch<React.SetStateAction<Message[]>>

export class ThrottledUpdater {
    private lastUpdateTime = 0
    private isFirstUpdate = true
    private pendingRAF: number | null = null

    private accumulatedContent = ""
    private accumulatedReasoning = ""
    private serverMessageId: string | null = null
    private serverGenerationId: string | null = null
    private pendingUpdate = false

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
        this.scheduleUpdate()
    }

    /**
     * Force immediate update with final content
     */
    flush(includeIds = true) {
        this.cancelPendingUpdate()
        this.doUpdate(includeIds)
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
        this.cancelPendingUpdate()
    }

    private cancelPendingUpdate() {
        if (this.pendingRAF !== null) {
            cancelAnimationFrame(this.pendingRAF)
            this.pendingRAF = null
        }
        this.pendingUpdate = false
    }

    private scheduleUpdate() {
        // Already have a pending update scheduled
        if (this.pendingUpdate) return

        const now = Date.now()
        const timeSinceLastUpdate = now - this.lastUpdateTime

        // First update or enough time passed - update on next frame
        if (this.isFirstUpdate || timeSinceLastUpdate >= this.minInterval) {
            this.pendingUpdate = true
            this.pendingRAF = requestAnimationFrame(() => {
                this.pendingRAF = null
                this.pendingUpdate = false
                this.doUpdate(false)
            })
        } else {
            // Schedule for later using RAF chain
            this.pendingUpdate = true
            const delay = this.minInterval - timeSinceLastUpdate
            setTimeout(() => {
                if (!this.pendingUpdate) return
                this.pendingRAF = requestAnimationFrame(() => {
                    this.pendingRAF = null
                    this.pendingUpdate = false
                    this.doUpdate(false)
                })
            }, delay)
        }
    }

    private doUpdate(includeIds: boolean) {
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

        // Use normal setState - React 18+ batches automatically
        this.setMessages(prev =>
            prev.map(m =>
                (m.id === clientId || m.id === serverId)
                    ? { ...m, ...update }
                    : m
            )
        )
    }
}
