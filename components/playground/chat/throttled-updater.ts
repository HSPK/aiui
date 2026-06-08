// Throttled Message Updater - handles batched UI updates during streaming
// Optimized: Removed flushSync to allow React to batch updates naturally

import type { AssembledToolCall, Message, MessageUpdate } from "./types"

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

    /** Tool calls assembled from streaming deltas, keyed by index so
     *  out-of-order chunks merge cleanly. Results are filled in as
     *  `aiui_tool_result` events arrive (keyed by id). */
    private toolCallsByIndex = new Map<number, AssembledToolCall & { index: number }>()
    private toolCallIndexById = new Map<string, number>()

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

    getServerMessageId() { return this.serverMessageId }
    getServerGenerationId() { return this.serverGenerationId }

    /**
     * Append content and trigger throttled update
     */
    appendContent(content: string, reasoning: string) {
        if (content) this.accumulatedContent += content
        if (reasoning) this.accumulatedReasoning += reasoning
        this.scheduleUpdate()
    }

    /** Merge a streaming tool-call delta into the in-progress message. */
    applyToolCallDelta(delta: { index: number; id?: string; name?: string; argumentsDelta?: string }) {
        const slot = this.toolCallsByIndex.get(delta.index) ?? {
            index: delta.index,
            id: "",
            name: "",
            arguments: "",
        }
        if (delta.id) {
            slot.id = delta.id
            this.toolCallIndexById.set(delta.id, delta.index)
        }
        if (delta.name) slot.name = delta.name
        if (delta.argumentsDelta) slot.arguments += delta.argumentsDelta
        this.toolCallsByIndex.set(delta.index, slot)
        this.scheduleUpdate()
    }

    /** Attach an MCP execution result to a previously-assembled tool call. */
    applyToolResult(result: { call_id: string; name: string; content: string; is_error: boolean; source?: string }) {
        const idx = this.toolCallIndexById.get(result.call_id)
        if (idx === undefined) {
            // Result arrived for a call we never saw a delta for —
            // synthesize a slot so it still renders.
            const synthetic: AssembledToolCall & { index: number } = {
                index: this.toolCallsByIndex.size,
                id: result.call_id,
                name: result.name,
                arguments: "",
                source: result.source,
                result: { content: result.content, is_error: result.is_error, source: result.source },
            }
            this.toolCallIndexById.set(result.call_id, synthetic.index)
            this.toolCallsByIndex.set(synthetic.index, synthetic)
        } else {
            const slot = this.toolCallsByIndex.get(idx)!
            slot.source = result.source ?? slot.source
            slot.result = {
                content: result.content,
                is_error: result.is_error,
                source: result.source,
            }
        }
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
            reasoning_content: this.accumulatedReasoning || undefined,
        }

        if (this.toolCallsByIndex.size > 0) {
            update.tool_calls = Array.from(this.toolCallsByIndex.values())
                .sort((a, b) => a.index - b.index)
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                .map(({ index: _idx, ...rest }) => rest)
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
