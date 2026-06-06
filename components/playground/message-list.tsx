"use client"

import { models } from "@/lib/api";
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
    messages,
    isLoading,
    onViewGeneration,
    onRegenerate,
    onRetryFailed,
    selectedSiblings,
    onSelectSibling
}: MessageListProps) => {
    const { data: modelsData } = models.useList(undefined, { staleTime: 5 * 60 * 1000 })

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
                    const hasNextUserMessage = messages.slice(index + 1).some(msg => msg.role === 'user')
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
        <div className={cn("pb-36 pt-4 max-w-full overflow-hidden", messages.length === 0 && "min-h-[calc(100vh-200px)] flex flex-col")}>
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
