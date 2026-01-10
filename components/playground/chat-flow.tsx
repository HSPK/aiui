"use client"

import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import { usePlaygroundChat } from "@/components/playground/use-playground-chat"
import { usePlaygroundStore } from "@/lib/stores/playground-store"
import { useSettingsStore } from "@/lib/stores/settings-store"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { ArrowUp } from "lucide-react"
import { MessageList } from "@/components/playground/message-list"
import { ChatInput } from "@/components/playground/chat-input"
import { useChatScroll, usePaginatedMessages } from "@/components/playground/hooks"
import { api } from "@/lib/api"
import { LogDetails } from "@/components/logs/log-details"

export function ChatFlow({ tabId }: { tabId: string }) {
    const { tabs, updateTab, updateTabTitle } = usePlaygroundStore()
    const settings = useSettingsStore()
    const queryClient = useQueryClient()
    const tab = tabs.find(t => t.id === tabId)

    // Track if we've generated a title for this conversation
    const titleGeneratedRef = React.useRef<Set<string>>(new Set())

    // Generation detail drawer state
    const [selectedGenerationId, setSelectedGenerationId] = React.useState<string | null>(null)

    // Local settings state - use user defaults from settings store
    const [temperature, setTemperature] = React.useState<number | undefined>(
        tab?.temperature ?? settings.defaultTemperature
    )
    const [historyLimit, setHistoryLimit] = React.useState(
        tab?.historyLimit ?? settings.defaultHistoryLimit
    )
    const [reasoningEffort, setReasoningEffort] = React.useState<string | null>(null)

    // Normalize messages from store
    const normalizedMessages = React.useMemo(() => {
        return tab?.messages?.map(m => ({
            ...m,
            id: m.id,
            role: m.role as any,
            content: typeof m.content === 'string'
                ? m.content
                : (Array.isArray(m.content) && m.content[0]?.text)
                    ? m.content[0].text
                    : String(m.content)
        })) || []
    }, [tab?.messages])

    // Chat hook
    const { messages, input, handleInputChange, handleSubmit, isLoading, setMessages, stop } = usePlaygroundChat({
        conversationId: tab?.conversationId,
        initialMessages: normalizedMessages,
    })

    // Pagination hook
    const { isLoadingMore, hasMore, loadMore } = usePaginatedMessages({
        conversationId: tab?.conversationId,
        initialMessages: messages,
        setMessages,
    })

    // Scroll hook
    const {
        viewportRef,
        showScrollBottom,
        handleScroll,
        scrollToBottom,
        preserveScrollPosition
    } = useChatScroll({
        messages,
        onLoadMore: () => {
            preserveScrollPosition(() => {
                loadMore()
            })
        },
        hasMore,
        isLoadingMore,
        savedScrollPosition: tab?.scrollPosition,
        onSaveScrollPosition: (pos) => updateTab(tabId, { scrollPosition: pos }),
    })

    // Handle model selection - memoized to prevent ChatInput re-renders
    const handleModelSelect = React.useCallback((ids: string[]) => {
        updateTab(tabId, { modelIds: ids })
    }, [tabId, updateTab])

    // Memoize config change handlers
    const handleTemperatureChange = React.useCallback((val: number | undefined) => {
        setTemperature(val)
        updateTab(tabId, { temperature: val })
    }, [tabId, updateTab])

    const handleHistoryLimitChange = React.useCallback((val: number) => {
        setHistoryLimit(val)
        updateTab(tabId, { historyLimit: val })
    }, [tabId, updateTab])

    const handleClearMessages = React.useCallback(() => {
        setMessages([])
    }, [setMessages])

    // Handle view generation details
    const handleViewGeneration = React.useCallback((generationId: string) => {
        setSelectedGenerationId(generationId)
    }, [])

    // Handle form submit
    const onFormSubmit = React.useCallback((e: React.FormEvent) => {
        const config: any = {
            stream: true,
            conv_history_limit: historyLimit
        }
        if (temperature !== undefined) config.temperature = temperature
        if (reasoningEffort) config.reasoning_effort = reasoningEffort

        handleSubmit(e, {
            models: tab?.modelIds || ["gpt-3.5-turbo"],
            config
        })
    }, [temperature, historyLimit, reasoningEffort, handleSubmit, tab?.modelIds])

    // Sync messages to store (debounced)
    React.useEffect(() => {
        const timeout = setTimeout(() => {
            const storeMessages = messages.map((m: any) => {
                let contentVal = m.content
                if (typeof contentVal !== 'string') {
                    if (Array.isArray(contentVal) && contentVal[0]?.text) {
                        contentVal = contentVal[0].text
                    } else if (typeof contentVal === 'object' && contentVal !== null) {
                        contentVal = JSON.stringify(contentVal)
                    }
                }

                return {
                    id: m.id,
                    conversation_id: tab?.conversationId || "",
                    role: m.role as any,
                    content: [{ type: "text", text: String(contentVal) }],
                    model_id: m.model_id,
                    reasoning_content: m.reasoning_content,
                    is_active: true,
                    created_at: m.created_at || new Date().toISOString(),
                    rating: m.rating,
                    generation_id: m.generation_id,
                    feedback: m.feedback
                }
            })
            updateTab(tabId, { messages: storeMessages as any })
        }, 1000)
        return () => clearTimeout(timeout)
    }, [messages, updateTab, tabId, tab?.conversationId])

    // Auto-generate title after first response
    React.useEffect(() => {
        const convId = tab?.conversationId
        const currentTitle = tab?.title
        if (!convId) return

        // Only generate title once per conversation
        if (titleGeneratedRef.current.has(convId)) return

        // Skip if conversation already has a meaningful title (not default)
        // This handles: existing conversations, tab switches, page refreshes
        const defaultTitles = ['Chat', 'New Tab', 'New Chat', '']
        if (currentTitle && !defaultTitles.includes(currentTitle)) {
            // Mark as already generated so we don't try again
            titleGeneratedRef.current.add(convId)
            return
        }

        // Need at least one user message and one assistant response
        if (messages.length < 2) return

        const userMsg = messages.find(m => m.role === 'user')
        const assistantMsg = messages.find(m => m.role === 'assistant' && m.content && m.content.length > 10)

        if (!userMsg || !assistantMsg) return

        // Don't generate if still loading (assistant might not be done)
        if (isLoading) return

        // Mark as generated to prevent duplicate calls
        titleGeneratedRef.current.add(convId)

        // Get summary model from settings, fallback to default model or first available
        const summaryModel = settings.defaultSummaryModel || settings.defaultModel || tab?.modelIds?.[0]
        if (!summaryModel) return

        // Generate title in background
        api.generateTitle(summaryModel, userMsg.content, assistantMsg.content)
            .then(title => {
                updateTabTitle(tabId, title)
                // Also update on backend
                api.updateConversationTitle(convId, title).catch(() => {
                    // Ignore backend errors, local title is sufficient
                })
                // Refresh sidebar history to show new conversation
                queryClient.invalidateQueries({ queryKey: ["conversations"] })
            })
            .catch(err => {
                console.error('Failed to generate title:', err)
            })
    }, [messages, isLoading, tab?.conversationId, tab?.title, tab?.modelIds, settings.defaultSummaryModel, settings.defaultModel, tabId, updateTabTitle])

    return (
        <div className="h-full relative overflow-hidden">
            <ScrollArea
                className="h-full w-full"
                viewportRef={viewportRef}
                onScroll={handleScroll}
            >
                <MessageList
                    messages={messages}
                    isLoading={isLoading}
                    onViewGeneration={handleViewGeneration}
                />
            </ScrollArea>

            <div className="absolute bottom-0 left-0 w-full p-4 z-10 bg-gradient-to-t from-background via-background/90 to-transparent pb-6">
                {showScrollBottom && (
                    <Button
                        variant="outline"
                        size="icon"
                        className="absolute -top-8 left-1/2 -translate-x-1/2 rounded-full h-8 w-8 shadow-md bg-background/80 backdrop-blur-sm hover:bg-background"
                        onClick={scrollToBottom}
                    >
                        <ArrowUp className="h-4 w-4 rotate-180" />
                    </Button>
                )}

                <ChatInput
                    input={input}
                    onInputChange={handleInputChange}
                    onSubmit={onFormSubmit}
                    isLoading={isLoading}
                    onStop={stop}
                    selectedModelIds={tab?.modelIds || []}
                    onModelSelect={handleModelSelect}
                    onClearMessages={handleClearMessages}
                    hasMessages={messages.length > 0}
                    temperature={temperature}
                    onTemperatureChange={handleTemperatureChange}
                    historyLimit={historyLimit}
                    onHistoryLimitChange={handleHistoryLimitChange}
                    reasoningEffort={reasoningEffort}
                    onReasoningEffortChange={setReasoningEffort}
                />
            </div>

            {/* Generation Detail Drawer */}
            <LogDetails
                logId={selectedGenerationId}
                open={!!selectedGenerationId}
                onOpenChange={(open) => !open && setSelectedGenerationId(null)}
            />
        </div>
    )
}
