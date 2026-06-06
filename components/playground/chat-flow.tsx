"use client"

import * as React from "react"
import { usePlaygroundChat } from "@/components/playground/use-playground-chat"
import { usePlaygroundStore } from "@/lib/stores/playground-store"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { ArrowUp } from "lucide-react"
import { MessageList } from "@/components/playground/message-list"
import { ChatInput } from "@/components/playground/chat-input"
import {
    useChatScroll,
    usePaginatedMessages,
    useChatConfig,
    useSiblingNavigation,
    useContextAssistant,
    useTitleGeneration,
    useMessageSync,
    useModelConfigs
} from "@/components/playground/hooks"
import { LogDetails } from "@/components/logs/log-details"
import { useShallow } from "zustand/react/shallow"

export function ChatFlow({ tabId }: { tabId: string }) {
    // Store access - use getState() for non-reactive reads
    const storeRef = React.useRef(usePlaygroundStore)
    const getTab = React.useCallback(() => storeRef.current.getState().tabs.find(t => t.id === tabId), [tabId])
    const getModelIds = React.useCallback(() => getTab()?.modelIds || [], [getTab])
    const updateTab = usePlaygroundStore((state) => state.updateTab)

    // Subscribe only to fields that need reactivity
    const conversationId = usePlaygroundStore(
        (state) => state.tabs.find(t => t.id === tabId)?.conversationId
    )
    const tabMessages = usePlaygroundStore(
        useShallow((state) => state.tabs.find(t => t.id === tabId)?.messages || [])
    )

    // Generation detail drawer state
    const [selectedGenerationId, setSelectedGenerationId] = React.useState<string | null>(null)

    // --- Custom Hooks ---

    // Global config (historyLimit)
    const { configRef, callbacksRef, historyLimit } = useChatConfig(tabId)

    // Per-model configs
    const { buildConfigForModel } = useModelConfigs(tabId)

    // Sibling navigation state
    const { selectedSiblings, onSelectSibling } = useSiblingNavigation()

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

    // Chat hook
    const {
        messages,
        handleSubmit,
        handleRetry,
        handleRetryFailed,
        handleRegenerate,
        isLoading,
        setMessages,
        stop,
        lastMessageIsUser
    } = usePlaygroundChat({
        conversationId,
        initialMessages: normalizedMessages,
    })

    // Context assistant calculation (for sibling branching)
    const { contextAssistantIdRef } = useContextAssistant(messages, selectedSiblings)

    // Pagination
    const { hasMore, loadMore, isLoadingMore } = usePaginatedMessages({
        conversationId,
        initialMessages: messages,
        setMessages,
    })

    // Scroll management
    const {
        viewportRef,
        showScrollBottom,
        handleScroll,
        scrollToBottom,
        preserveScrollPosition
    } = useChatScroll({
        messages,
        onLoadMore: () => preserveScrollPosition(loadMore),
        hasMore,
        isLoadingMore,
        savedScrollPosition: getTab()?.scrollPosition,
        onSaveScrollPosition: (pos) => updateTab(tabId, { scrollPosition: pos }),
    })

    // Auto-generate title
    useTitleGeneration({
        tabId,
        conversationId,
        messages,
        isLoading,
        getModelIds
    })

    // Sync messages to store & refresh sidebar
    useMessageSync({
        tabId,
        conversationId,
        messages,
        isLoading
    })

    // --- Handlers ---

    const handleViewGeneration = React.useCallback((generationId: string) => {
        setSelectedGenerationId(generationId)
    }, [])

    // Build per-model config for API calls
    const buildPerModelConfig = React.useCallback((modelId: string) => {
        return buildConfigForModel(modelId, historyLimit)
    }, [buildConfigForModel, historyLimit])

    // Form submit - receives input text directly from ChatInput
    const onFormSubmit = React.useCallback((inputText: string) => {
        const modelIds = getModelIds()
        handleSubmit(inputText, {
            models: modelIds.length > 0 ? modelIds : ["gpt-3.5-turbo"],
            getModelConfig: buildPerModelConfig,
            contextMessageId: contextAssistantIdRef.current
        })
    }, [buildPerModelConfig, handleSubmit, getModelIds, contextAssistantIdRef])

    // Retry (when last message is user - no assistant response yet)
    const onRetry = React.useCallback(() => {
        handleRetry({
            models: getModelIds(),
            getModelConfig: buildPerModelConfig
        })
    }, [buildPerModelConfig, handleRetry, getModelIds])

    // Regenerate (create sibling response for last assistant message)
    const onRegenerate = React.useCallback(() => {
        handleRegenerate({
            models: getModelIds(),
            getModelConfig: buildPerModelConfig
        })
    }, [buildPerModelConfig, handleRegenerate, getModelIds])

    // Per-message retry — triggered by the retry button on an inline
    // error card. Re-streams just that one failed assistant slot.
    const onRetryFailed = React.useCallback((failedAssistantId: string) => {
        handleRetryFailed(failedAssistantId, {
            models: getModelIds(),
            getModelConfig: buildPerModelConfig
        })
    }, [buildPerModelConfig, handleRetryFailed, getModelIds])

    // --- Render ---

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
                        onRetryFailed={onRetryFailed}
                        selectedSiblings={selectedSiblings}
                        onSelectSibling={onSelectSibling}
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
                    callbacksRef={callbacksRef}
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
