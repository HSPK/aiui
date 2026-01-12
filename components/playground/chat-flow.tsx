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
import { useShallow } from "zustand/react/shallow"

export function ChatFlow({ tabId }: { tabId: string }) {
    // Use getState() for reading tab data to avoid subscription
    const storeRef = React.useRef(usePlaygroundStore)
    const getTab = React.useCallback(() => storeRef.current.getState().tabs.find(t => t.id === tabId), [tabId])

    // Only subscribe to specific fields that need reactivity - NOT modelIds (handled by ConnectedModelSelector)
    const conversationId = usePlaygroundStore(
        (state) => state.tabs.find(t => t.id === tabId)?.conversationId
    )
    const tabMessages = usePlaygroundStore(
        useShallow((state) => state.tabs.find(t => t.id === tabId)?.messages || [])
    )
    const tabTitle = usePlaygroundStore(
        (state) => state.tabs.find(t => t.id === tabId)?.title
    )

    const updateTab = usePlaygroundStore((state) => state.updateTab)
    const updateTabTitle = usePlaygroundStore((state) => state.updateTabTitle)
    const settings = useSettingsStore()
    const queryClient = useQueryClient()

    // Track if we've generated a title for this conversation
    const titleGeneratedRef = React.useRef<Set<string>>(new Set())

    // Generation detail drawer state
    const [selectedGenerationId, setSelectedGenerationId] = React.useState<string | null>(null)

    // Sibling navigation state - map of parent_id to selected index
    const [selectedSiblings, setSelectedSiblings] = React.useState<Map<string, number>>(new Map())

    // Local settings state - use user defaults from settings store
    const initialTab = getTab()
    const [temperature, setTemperature] = React.useState<number | undefined>(
        initialTab?.temperature ?? settings.defaultTemperature
    )
    const [historyLimit, setHistoryLimit] = React.useState(
        initialTab?.historyLimit ?? settings.defaultHistoryLimit
    )
    const [reasoningEffort, setReasoningEffort] = React.useState<string | null>(null)

    // Normalize messages from store
    const normalizedMessages = React.useMemo(() => {
        return tabMessages.map(m => ({
            ...m,
            id: m.id,
            role: m.role as any,
            content: typeof m.content === 'string'
                ? m.content
                : (Array.isArray(m.content) && m.content[0]?.text)
                    ? m.content[0].text
                    : String(m.content)
        }))
    }, [tabMessages])

    // Chat hook - no longer need input/handleInputChange from here
    const { messages, handleSubmit, handleRetry, handleRegenerate, isLoading, setMessages, stop, lastMessageIsUser } = usePlaygroundChat({
        conversationId,
        initialMessages: normalizedMessages,
    })

    // Pagination hook
    const { isLoadingMore, hasMore, loadMore } = usePaginatedMessages({
        conversationId,
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
        savedScrollPosition: getTab()?.scrollPosition,
        onSaveScrollPosition: (pos) => updateTab(tabId, { scrollPosition: pos }),
    })

    // Determine which assistant message is selected as context for the next user message
    const contextAssistantId = React.useMemo(() => {
        // Find the last user message
        let lastUser: any | null = null
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role === 'user') {
                lastUser = messages[i]
                break
            }
        }

        if (!lastUser) {
            // Fallback: last assistant in the list
            const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant')
            return lastAssistant?.id
        }

        // Get siblings of the last user message
        const siblings = messages.filter(m => m.role === 'assistant' && m.parent_id === lastUser.id)
        if (siblings.length === 0) {
            const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant')
            return lastAssistant?.id
        }

        // Sort siblings by created_at
        siblings.sort((a, b) => {
            const dateA = new Date(a.created_at || a.createdAt || 0).getTime()
            const dateB = new Date(b.created_at || b.createdAt || 0).getTime()
            return dateA - dateB
        })

        // Priority: 1. User selection (from selectedSiblings Map)
        if (selectedSiblings.has(lastUser.id)) {
            const selectedIdx = selectedSiblings.get(lastUser.id)!
            const safeIdx = Math.min(selectedIdx, siblings.length - 1)
            return siblings[safeIdx]?.id
        }

        // Priority: 2. Find which sibling is used as parent by subsequent messages
        const usedAsParent = new Set<string>()
        messages.forEach((m: any) => {
            if (m.parent_id) usedAsParent.add(m.parent_id)
        })

        for (let i = 0; i < siblings.length; i++) {
            if (usedAsParent.has(siblings[i].id)) {
                return siblings[i].id
            }
        }

        // Priority: 3. Default to last sibling
        return siblings[siblings.length - 1]?.id
    }, [messages, selectedSiblings])

    // Config ref for ChatInput - prevents re-renders
    const configRef = React.useRef({ temperature, historyLimit, reasoningEffort })
    configRef.current = { temperature, historyLimit, reasoningEffort }

    // Callbacks ref for ChatInput - stable reference
    const configCallbacksRef = React.useRef({
        onTemperatureChange: (val: number | undefined) => {
            setTemperature(val)
            updateTab(tabId, { temperature: val })
        },
        onHistoryLimitChange: (val: number) => {
            setHistoryLimit(val)
            updateTab(tabId, { historyLimit: val })
        },
        onReasoningEffortChange: setReasoningEffort
    })

    const handleClearMessages = React.useCallback(() => {
        setMessages([])
    }, [setMessages])

    // Handle view generation details
    const handleViewGeneration = React.useCallback((generationId: string) => {
        setSelectedGenerationId(generationId)
    }, [])

    // Handle sibling selection
    const handleSelectSibling = React.useCallback((parentId: string, index: number) => {
        setSelectedSiblings(prev => {
            const next = new Map(prev)
            next.set(parentId, index)
            return next
        })
    }, [])

    // Build chat config - use ref to avoid dependency changes (reuse configRef from above)
    const buildChatConfig = React.useCallback(() => {
        const { temperature, historyLimit, reasoningEffort } = configRef.current
        const config: any = {
            stream: true,
            conv_history_limit: historyLimit
        }
        if (temperature !== undefined) config.temperature = temperature
        if (reasoningEffort) config.reasoning_effort = reasoningEffort
        return config
    }, []) // No dependencies - uses ref

    // Context assistant ID ref for stable callback
    const contextAssistantIdRef = React.useRef(contextAssistantId)
    contextAssistantIdRef.current = contextAssistantId

    // Handle form submit - receives input text directly from ChatInput
    // OPTIMIZED: Stable callback that doesn't change on every render
    const onFormSubmit = React.useCallback((inputText: string) => {
        const currentModelIds = getTab()?.modelIds || []
        handleSubmit(inputText, {
            models: currentModelIds.length > 0 ? currentModelIds : ["gpt-3.5-turbo"],
            config: buildChatConfig(),
            contextMessageId: contextAssistantIdRef.current || undefined
        })
    }, [buildChatConfig, handleSubmit, getTab]) // Removed contextAssistantId - using ref

    // Handle retry (when last message is user - no assistant response yet)
    const onRetry = React.useCallback(() => {
        const currentModelIds = getTab()?.modelIds || []
        handleRetry({
            models: currentModelIds,
            config: buildChatConfig()
        })
    }, [buildChatConfig, handleRetry, getTab])

    // Handle regenerate (create a sibling response for last assistant message)
    const onRegenerate = React.useCallback(() => {
        const currentModelIds = getTab()?.modelIds || []
        handleRegenerate({
            models: currentModelIds,
            config: buildChatConfig()
        })
    }, [buildChatConfig, handleRegenerate, getTab])

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
                    conversation_id: conversationId || "",
                    role: m.role as any,
                    content: [{ type: "text", text: String(contentVal) }],
                    model_id: m.model_id,
                    reasoning_content: m.reasoning_content,
                    is_active: true,
                    created_at: m.created_at || new Date().toISOString(),
                    rating: m.rating,
                    generation_id: m.generation_id,
                    feedback: m.feedback,
                    parent_id: m.parent_id
                }
            })
            updateTab(tabId, { messages: storeMessages as any })
        }, 1000)
        return () => clearTimeout(timeout)
    }, [messages, updateTab, tabId, conversationId])

    // Refresh sidebar when message sending completes (to update order by updated_at)
    const prevIsLoadingRef = React.useRef(isLoading)
    React.useEffect(() => {
        // Detect transition from loading to not loading (message sent)
        if (prevIsLoadingRef.current && !isLoading && messages.length > 0) {
            queryClient.invalidateQueries({ queryKey: ["conversations"] })
        }
        prevIsLoadingRef.current = isLoading
    }, [isLoading, messages.length, queryClient])

    // Auto-generate title after first response
    React.useEffect(() => {
        const convId = conversationId
        const currentTitle = tabTitle
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
        const currentModelIds = getTab()?.modelIds || []
        const summaryModel = settings.defaultSummaryModel || settings.defaultModel || currentModelIds[0]
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
    }, [messages, isLoading, conversationId, tabTitle, getTab, settings.defaultSummaryModel, settings.defaultModel, tabId, updateTabTitle, queryClient])

    return (
        <div className="h-full relative overflow-hidden w-full max-w-full">
            <ScrollArea
                className="h-full w-full"
                viewportRef={viewportRef}
                onScroll={handleScroll}
            >
                <div className="w-full max-w-full overflow-hidden">
                    <MessageList
                        messages={messages}
                        isLoading={isLoading}
                        onViewGeneration={handleViewGeneration}
                        onRetry={onRegenerate}
                        selectedSiblings={selectedSiblings}
                        onSelectSibling={handleSelectSibling}
                    />
                </div>
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
                    tabId={tabId}
                    onSubmit={onFormSubmit}
                    onRetry={onRetry}
                    isLoading={isLoading}
                    onStop={stop}
                    lastMessageIsUser={lastMessageIsUser}
                    configRef={configRef}
                    callbacksRef={configCallbacksRef}
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
