"use client"

import { models } from "@/lib/api/models";
import * as React from "react"
import { Bot } from "lucide-react"
import { cn, formatRelativeDate, normalizeDate } from "@/lib/utils"
import type { Message } from "@/components/playground/chat/types"

import { ChatMessage } from "./chat-message"

const DateSeparator = React.memo(({ date }: { date: string | Date }) => (
    <div className="relative flex items-center justify-center my-6">
        <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t" />
        </div>
        <div className="relative bg-background px-3 text-xs text-muted-foreground font-medium rounded-full border">
            <span suppressHydrationWarning>
                {formatRelativeDate(date)}
            </span>
        </div>
    </div>
))
DateSeparator.displayName = "DateSeparator"

interface MessageListProps {
    messages: Message[]
    isLoading: boolean
    onViewGeneration?: (generationId: string) => void
    /** Create a sibling response for the last assistant message
     *  (different from retry — runs on a successful completion to
     *  generate an alternative). */
    onRegenerate?: () => void
    /** Per-message retry for a failed assistant slot. Wired to the
     *  retry button on the inline error card. */
    onRetryFailed?: (failedAssistantId: string) => void
    // For sibling navigation - map of parent_id to selected sibling index
    selectedSiblings?: Map<string, number>
    onSelectSibling?: (parentId: string, index: number) => void
}

export const MessageList = React.memo(({
    messages: rawMessages,
    isLoading,
    onViewGeneration,
    onRegenerate,
    onRetryFailed,
    selectedSiblings,
    onSelectSibling
}: MessageListProps) => {
    const { data: modelsData } = models.useList(undefined, { staleTime: 5 * 60 * 1000 })

    // Fold persisted `role: "tool"` messages into the parent assistant's
    // tool_calls[].result so they render inline inside the bubble (just
    // like during streaming) instead of as standalone messages.
    const messages = React.useMemo(() => foldToolMessages(rawMessages), [rawMessages])

    const modelProviderMap = React.useMemo(() => {
        const map = new Map<string, string>()
        if (Array.isArray(modelsData)) {
            modelsData.forEach((m) => {
                if (m.provider) {
                    if (m.name) map.set(m.name, m.provider)
                    if (m.model_id) map.set(m.model_id, m.provider)
                }
            })
        }
        return map
    }, [modelsData])

    // Build sibling groups: group assistant messages by their parent_id
    const siblingGroups = React.useMemo(() => {
        const groups = new Map<string, Message[]>()

        messages.forEach((m) => {
            if (m.role === 'assistant' && m.parent_id) {
                const siblings = groups.get(m.parent_id) || []
                siblings.push(m)
                groups.set(m.parent_id, siblings)
            }
        })

        // Sort each group by created_at to maintain order
        groups.forEach((siblings) => {
            siblings.sort((a, b) => {
                const dateA = new Date(a.created_at || 0).getTime()
                const dateB = new Date(b.created_at || 0).getTime()
                return dateA - dateB
            })
        })

        return groups
    }, [messages])

    // Build a map of which sibling is "active" based on conversation flow
    // If a subsequent message uses a sibling as parent, that sibling is the active one
    const activeSiblingMap = React.useMemo(() => {
        const activeMap = new Map<string, number>() // parent_id -> active sibling index

        // Build a set of all message IDs that are used as parent_id by subsequent messages
        const usedAsParent = new Set<string>()
        messages.forEach((m) => {
            if (m.parent_id) {
                usedAsParent.add(m.parent_id)
            }
        })

        // For each sibling group, find which sibling is used as parent
        siblingGroups.forEach((siblings, parentId) => {
            for (let i = 0; i < siblings.length; i++) {
                if (usedAsParent.has(siblings[i].id)) {
                    activeMap.set(parentId, i)
                    break
                }
            }
            // If none is used as parent, don't set - will use selectedSiblings or default
        })

        return activeMap
    }, [messages, siblingGroups])

    // Get the effective selected index for a sibling group
    const getSelectedIndex = React.useCallback((parentId: string, siblingsLength: number) => {
        // Priority: 1. User selection, 2. Active in conversation flow, 3. Default to last
        if (selectedSiblings?.has(parentId)) {
            return selectedSiblings.get(parentId)!
        }
        if (activeSiblingMap.has(parentId)) {
            return activeSiblingMap.get(parentId)!
        }
        return siblingsLength - 1
    }, [selectedSiblings, activeSiblingMap])

    // Find the last visible assistant message index
    const lastAssistantIndex = React.useMemo(() => {
        // Process messages to find what would be displayed
        const visibleMessages: Message[] = []
        const seenParentIds = new Set<string>()

        messages.forEach((m) => {
            if (m.role === 'user') {
                visibleMessages.push(m)
            } else if (m.role === 'assistant' && m.parent_id) {
                // For assistant messages with siblings, only show selected one
                const siblings = siblingGroups.get(m.parent_id)
                if (siblings && siblings.length > 1) {
                    if (!seenParentIds.has(m.parent_id)) {
                        seenParentIds.add(m.parent_id)
                        const selectedIdx = getSelectedIndex(m.parent_id, siblings.length)
                        visibleMessages.push(siblings[selectedIdx])
                    }
                } else {
                    visibleMessages.push(m)
                }
            } else {
                visibleMessages.push(m)
            }
        })

        // Find last assistant
        for (let i = visibleMessages.length - 1; i >= 0; i--) {
            if (visibleMessages[i].role === 'assistant') {
                return visibleMessages[i].id
            }
        }
        return null
    }, [messages, siblingGroups, getSelectedIndex])

    // Process messages to inject date separators and handle siblings
    const renderItems = React.useMemo(() => {
        const items: React.ReactNode[] = []
        let lastDate: string | null = null
        const seenParentIds = new Set<string>()

        // Precompute the position of the last `role: "user"` message
        // so the per-message "is anything after me a user turn?" check
        // is O(1) instead of an O(n) slice+some(). Without this, a chat
        // with many sibling groups is O(n²) per render.
        let lastUserIndex = -1
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role === 'user') { lastUserIndex = i; break }
        }

        messages.forEach((m, index) => {
            // For assistant messages with siblings, only render selected one
            if (m.role === 'assistant' && m.parent_id) {
                const siblings = siblingGroups.get(m.parent_id)
                if (siblings && siblings.length > 1) {
                    // Render all siblings side-by-side
                    if (seenParentIds.has(m.parent_id)) {
                        return // Skip - already rendered this group
                    }
                    seenParentIds.add(m.parent_id)

                    const selectedIdx = getSelectedIndex(m.parent_id, siblings.length)
                    // Use date of the LAST sibling for separator logic (to keep it consistent)
                    const lastSibling = siblings[siblings.length - 1]
                    const mDate = lastSibling.created_at
                    const dateObj = normalizeDate(mDate)
                    const currentDate = dateObj.toDateString()

                    // Check if this is the latest message group (no user messages after it)
                    // We only allow selection on the head of the conversation
                    const hasNextUserMessage = lastUserIndex > index
                    const canSelect = !hasNextUserMessage

                    if (currentDate !== lastDate) {
                        items.push(<DateSeparator key={`date-${currentDate}-${index}`} date={mDate ?? new Date()} />)
                        lastDate = currentDate
                    }

                    const parentId = m.parent_id
                    items.push(
                        <div key={`group-${parentId}`} className="w-0 min-w-full overflow-x-auto pb-4 scrollbar-none">
                            <div className="inline-flex gap-3 px-4 sm:px-6 md:px-8 lg:px-12">
                                {siblings.map((sibling, idx) => (
                                    <ChatMessage
                                        key={sibling.id}
                                        message={sibling}
                                        provider={sibling.model_id ? modelProviderMap.get(sibling.model_id) : undefined}
                                        isTyping={isLoading && !sibling.generation_id && !sibling.error}
                                        onViewGeneration={onViewGeneration}
                                        isLastAssistant={sibling.id === lastAssistantIndex}
                                        onRegenerate={onRegenerate}
                                        onRetryFailed={onRetryFailed}
                                        isLoading={isLoading}
                                        isSibling={true}
                                        siblingCount={siblings.length}
                                        isSelected={idx === selectedIdx}
                                        onSelect={canSelect ? () => onSelectSibling?.(parentId, idx) : undefined}
                                    />
                                ))}
                            </div>
                        </div>
                    )
                    return
                }
            }

            const mDate = m.created_at
            const dateObj = normalizeDate(mDate)
            const currentDate = dateObj.toDateString()

            if (currentDate !== lastDate) {
                items.push(<DateSeparator key={`date-${currentDate}-${index}`} date={mDate ?? new Date()} />)
                lastDate = currentDate
            }

            items.push(
                <ChatMessage
                    key={m.id}
                    message={m}
                    provider={m.model_id ? modelProviderMap.get(m.model_id) : undefined}
                    isTyping={isLoading && m.role === 'assistant' && !m.generation_id && !m.error}
                    onViewGeneration={onViewGeneration}
                    isLastAssistant={m.id === lastAssistantIndex && m.role === 'assistant'}
                    onRegenerate={m.role === 'assistant' ? onRegenerate : undefined}
                    onRetryFailed={m.role === 'assistant' ? onRetryFailed : undefined}
                    isLoading={isLoading}
                />
            )
        })
        return items
    }, [messages, isLoading, modelProviderMap, onViewGeneration, siblingGroups, getSelectedIndex, onSelectSibling, lastAssistantIndex, onRegenerate, onRetryFailed])

    return (
        <div
            className={cn(
                "pb-36 pt-4 max-w-full overflow-hidden",
                // When empty, match the bottom padding so the centered icon
                // sits visually mid-way between the top of the chat surface
                // and the top of the floating ChatInput (which lives in the
                // pb-36 buffer).
                messages.length === 0 && "min-h-[calc(100vh-200px)] flex flex-col pt-36",
            )}
        >
            {messages.length === 0 && (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-muted-foreground opacity-50 space-y-4">
                    <Bot className="h-12 w-12" />
                    <p>Start a conversation...</p>
                </div>
            )}

            {renderItems}
        </div>
    )
})
MessageList.displayName = "MessageList"

// =============================================================================
// Tool-message folding
// =============================================================================

/**
 * `role: "tool"` messages persist results of MCP function calls. Each
 * one carries a single `tool_result` part whose `tool_call_id` links
 * back to a `tool_call` part on the preceding assistant message. We
 * hoist those results into the assistant message's `tool_calls` field
 * so they render inline (matching the live-stream experience) instead
 * of as standalone bubbles.
 */
function foldToolMessages(messages: Message[]): Message[] {
    if (messages.length === 0) return messages

    type StoredToolResult = { tool_call_id: string; name?: string; content: string; is_error?: boolean; source?: string }

    // First pass: collect every tool_result keyed by call id, and
    // every tool_call_id known to a loaded assistant message (so we
    // can detect orphans whose parent isn't in the current page).
    const resultByCallId = new Map<string, StoredToolResult>()
    const knownCallIds = new Set<string>()
    for (const m of messages) {
        if (m.role === "tool" && Array.isArray(m.content)) {
            for (const p of m.content as ContentPartLike[]) {
                if (p.type === "tool_result") {
                    const tr = (p as { tool_result?: StoredToolResult }).tool_result
                    if (tr?.tool_call_id) resultByCallId.set(tr.tool_call_id, tr)
                }
            }
        } else if (m.role === "assistant" && Array.isArray(m.content)) {
            for (const p of m.content as ContentPartLike[]) {
                if (p.type === "tool_call") {
                    const tc = (p as { tool_call?: { id: string } }).tool_call
                    if (tc?.id) knownCallIds.add(tc.id)
                }
            }
        }
    }

    // Project assistant messages with their resolved tool results;
    // drop tool rows that fold into a known parent; keep orphan tool
    // rows so the user still sees the execution trail when an older
    // page hasn't loaded the parent assistant yet.
    const out: Message[] = []
    for (const m of messages) {
        if (m.role === "tool") {
            // Render only if NO known assistant has this call id.
            const parts = Array.isArray(m.content) ? (m.content as ContentPartLike[]) : []
            const callIds = parts
                .filter((p) => p.type === "tool_result")
                .map((p) => (p as { tool_result?: StoredToolResult }).tool_result?.tool_call_id)
                .filter((id): id is string => !!id)
            const isOrphan = callIds.length > 0 && callIds.every((id) => !knownCallIds.has(id))
            if (isOrphan) out.push(m)
            continue
        }
        if (m.role !== "assistant" || !Array.isArray(m.content)) {
            out.push(m)
            continue
        }
        const calls: NonNullable<Message["tool_calls"]> = []
        for (const p of m.content as ContentPartLike[]) {
            if (p.type === "tool_call") {
                const tc = (p as { tool_call?: { id: string; name: string; arguments: string; source?: string } }).tool_call
                if (!tc) continue
                const result = resultByCallId.get(tc.id)
                calls.push({
                    id: tc.id,
                    name: tc.name,
                    arguments: tc.arguments,
                    source: tc.source,
                    result: result
                        ? { content: result.content, is_error: !!result.is_error, source: result.source }
                        : undefined,
                })
            }
        }
        out.push(calls.length > 0 ? { ...m, tool_calls: calls } : m)
    }
    return out
}

type ContentPartLike = { type: string }
