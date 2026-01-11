"use client"

import * as React from "react"
import { Bot } from "lucide-react"
import { cn, formatRelativeDate, normalizeDate } from "@/lib/utils"
import { api } from "@/lib/api"
import { useQuery } from "@tanstack/react-query"
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
    messages: any[]
    isLoading: boolean
    onViewGeneration?: (generationId: string) => void
    onRetry?: () => void
    // For sibling navigation - map of parent_id to selected sibling index
    selectedSiblings?: Map<string, number>
    onSelectSibling?: (parentId: string, index: number) => void
}

export const MessageList = React.memo(({
    messages,
    isLoading,
    onViewGeneration,
    onRetry,
    selectedSiblings,
    onSelectSibling
}: MessageListProps) => {
    const { data: modelsData } = useQuery({
        queryKey: ["models"],
        queryFn: () => api.getModels(),
        staleTime: 1000 * 60 * 5, // Cache for 5 mins
    })

    const modelProviderMap = React.useMemo(() => {
        const map = new Map<string, string>()
        if (Array.isArray(modelsData)) {
            modelsData.forEach((m: any) => {
                if (m.name) map.set(m.name, m.provider)
                if (m.model_id) map.set(m.model_id, m.provider)
            })
        }
        return map
    }, [modelsData])

    // Build sibling groups: group assistant messages by their parent_id
    const siblingGroups = React.useMemo(() => {
        const groups = new Map<string, any[]>()  // parent_id -> array of sibling messages

        messages.forEach((m: any) => {
            if (m.role === 'assistant' && m.parent_id) {
                const siblings = groups.get(m.parent_id) || []
                siblings.push(m)
                groups.set(m.parent_id, siblings)
            }
        })

        // Sort each group by created_at to maintain order
        groups.forEach((siblings, key) => {
            siblings.sort((a, b) => {
                const dateA = new Date(a.created_at || a.createdAt || 0).getTime()
                const dateB = new Date(b.created_at || b.createdAt || 0).getTime()
                return dateA - dateB
            })
        })

        return groups
    }, [messages])

    // Find the last visible assistant message index
    const lastAssistantIndex = React.useMemo(() => {
        // Process messages to find what would be displayed
        const visibleMessages: any[] = []
        const seenParentIds = new Set<string>()

        messages.forEach((m: any) => {
            if (m.role === 'user') {
                visibleMessages.push(m)
            } else if (m.role === 'assistant' && m.parent_id) {
                // For assistant messages with siblings, only show selected one
                const siblings = siblingGroups.get(m.parent_id)
                if (siblings && siblings.length > 1) {
                    if (!seenParentIds.has(m.parent_id)) {
                        seenParentIds.add(m.parent_id)
                        const selectedIdx = selectedSiblings?.get(m.parent_id) ?? siblings.length - 1
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
    }, [messages, siblingGroups, selectedSiblings])

    // Process messages to inject date separators and handle siblings
    const renderItems = React.useMemo(() => {
        const items: React.ReactNode[] = []
        let lastDate: string | null = null
        const seenParentIds = new Set<string>()

        messages.forEach((m: any, index: number) => {
            // For assistant messages with siblings, only render selected one
            if (m.role === 'assistant' && m.parent_id) {
                const siblings = siblingGroups.get(m.parent_id)
                if (siblings && siblings.length > 1) {
                    // Only render the selected sibling (default to latest)
                    if (seenParentIds.has(m.parent_id)) {
                        return // Skip - already rendered a sibling for this parent
                    }
                    seenParentIds.add(m.parent_id)

                    const selectedIdx = selectedSiblings?.get(m.parent_id) ?? siblings.length - 1
                    const selectedMessage = siblings[selectedIdx]

                    const mDate = selectedMessage.created_at || selectedMessage.createdAt
                    const dateObj = normalizeDate(mDate)
                    const currentDate = dateObj.toDateString()

                    if (currentDate !== lastDate) {
                        items.push(<DateSeparator key={`date-${currentDate}-${index}`} date={mDate} />)
                        lastDate = currentDate
                    }

                    items.push(
                        <ChatMessage
                            key={selectedMessage.id}
                            message={selectedMessage}
                            provider={selectedMessage.model_id ? modelProviderMap.get(selectedMessage.model_id) : undefined}
                            isTyping={isLoading && selectedMessage.id === lastAssistantIndex}
                            onViewGeneration={onViewGeneration}
                            isLastAssistant={selectedMessage.id === lastAssistantIndex}
                            onRetry={onRetry}
                            isLoading={isLoading}
                            siblingIndex={selectedIdx}
                            siblingCount={siblings.length}
                            onNavigateSibling={(direction) => {
                                const newIdx = direction === 'prev'
                                    ? Math.max(0, selectedIdx - 1)
                                    : Math.min(siblings.length - 1, selectedIdx + 1)
                                onSelectSibling?.(m.parent_id, newIdx)
                            }}
                        />
                    )
                    return
                }
            }

            const mDate = m.created_at || m.createdAt
            const dateObj = normalizeDate(mDate)
            const currentDate = dateObj.toDateString()

            if (currentDate !== lastDate) {
                items.push(<DateSeparator key={`date-${currentDate}-${index}`} date={mDate} />)
                lastDate = currentDate
            }

            items.push(
                <ChatMessage
                    key={m.id}
                    message={m}
                    provider={m.model_id ? modelProviderMap.get(m.model_id) : undefined}
                    isTyping={isLoading && index === messages.length - 1 && m.role === 'assistant'}
                    onViewGeneration={onViewGeneration}
                    isLastAssistant={m.id === lastAssistantIndex && m.role === 'assistant'}
                    onRetry={m.role === 'assistant' ? onRetry : undefined}
                    isLoading={isLoading}
                />
            )
        })
        return items
    }, [messages, isLoading, modelProviderMap, onViewGeneration, siblingGroups, selectedSiblings, onSelectSibling, lastAssistantIndex, onRetry])

    return (
        <div className={cn("pb-36 pt-4", messages.length === 0 && "min-h-[calc(100vh-200px)] flex flex-col")}>
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
