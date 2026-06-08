"use client"

import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import { ArrowUp, Loader2 } from "lucide-react"

import { usePlaygroundChat } from "@/components/playground/use-playground-chat"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
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
    useModelConfigs,
} from "@/components/playground/hooks"
import { readCachedMessages } from "@/components/playground/hooks/use-paginated-messages"
import { LogDetails } from "@/components/logs/log-details"
import { usePlaygroundStore } from "@/lib/stores/playground-store"

const INITIAL_PAGE_SIZE = 20

/** Single-conversation chat surface. `conversationId` comes from the
 *  URL via the chat page's `?c=` query param. */
export function ChatFlow({ conversationId }: { conversationId: string }) {
    const queryClient = useQueryClient()

    const getModelIds = React.useCallback(
        () => usePlaygroundStore.getState().getSettings(conversationId).modelIds ?? [],
        [conversationId]
    )

    const [selectedGenerationId, setSelectedGenerationId] = React.useState<string | null>(null)

    const { historyLimit, systemPrompt } = useChatConfig(conversationId)
    const { buildConfigForModel } = useModelConfigs(conversationId)
    const { selectedSiblings, onSelectSibling } = useSiblingNavigation()

    // Seed from the cached initial page (if present) so revisiting a
    // recently-viewed conversation renders messages immediately on mount
    // — no fetch flash. Computed once per mount; conversationId change
    // triggers a fresh mount via the `key` prop in the chat page.
    const cachedInitial = React.useMemo(
        () => readCachedMessages(queryClient, conversationId, INITIAL_PAGE_SIZE) ?? [],
        [queryClient, conversationId]
    )

    const {
        messages,
        handleSubmit,
        handleRetryFailed,
        handleRegenerate,
        isLoading,
        setMessages,
        stop,
    } = usePlaygroundChat({ conversationId, initialMessages: cachedInitial })

    const { contextAssistantIdRef } = useContextAssistant(messages, selectedSiblings)

    const { hasMore, loadMore, isLoadingMore, isInitialLoading } = usePaginatedMessages({
        conversationId,
        initialMessages: messages,
        setMessages,
        pageSize: INITIAL_PAGE_SIZE,
    })

    const {
        viewportRef,
        showScrollBottom,
        handleScroll,
        scrollToBottom,
        preserveScrollPosition,
    } = useChatScroll({
        messages,
        onLoadMore: () => preserveScrollPosition(loadMore),
        hasMore,
        isLoadingMore,
    })

    useTitleGeneration({ conversationId, messages, isLoading, getModelIds })
    useMessageSync({ conversationId, messages, isLoading, pageSize: INITIAL_PAGE_SIZE })

    const handleViewGeneration = React.useCallback(
        (generationId: string) => setSelectedGenerationId(generationId),
        []
    )

    const buildPerModelConfig = React.useCallback(
        (modelId: string) => buildConfigForModel(modelId, historyLimit, systemPrompt),
        [buildConfigForModel, historyLimit, systemPrompt]
    )

    const getEnabledMcpServerIds = React.useCallback(
        () => usePlaygroundStore.getState().getSettings(conversationId).enabledMcpServerIds ?? [],
        [conversationId]
    )

    const onFormSubmit = React.useCallback(
        (input: import("@/lib/schemas/content").MessageContent) => {
            const modelIds = getModelIds()
            handleSubmit(input, {
                models: modelIds.length > 0 ? modelIds : ["gpt-3.5-turbo"],
                getModelConfig: buildPerModelConfig,
                contextMessageId: contextAssistantIdRef.current,
                enabledMcpServerIds: getEnabledMcpServerIds(),
            })
        },
        [buildPerModelConfig, handleSubmit, getModelIds, contextAssistantIdRef, getEnabledMcpServerIds]
    )

    const onRegenerate = React.useCallback(() => {
        handleRegenerate({
            models: getModelIds(),
            getModelConfig: buildPerModelConfig,
            enabledMcpServerIds: getEnabledMcpServerIds(),
        })
    }, [buildPerModelConfig, handleRegenerate, getModelIds, getEnabledMcpServerIds])

    const onRetryFailed = React.useCallback(
        (failedAssistantId: string) => {
            handleRetryFailed(failedAssistantId, {
                models: getModelIds(),
                getModelConfig: buildPerModelConfig,
                enabledMcpServerIds: getEnabledMcpServerIds(),
            })
        },
        [buildPerModelConfig, handleRetryFailed, getModelIds, getEnabledMcpServerIds]
    )

    const showInitialLoading = isInitialLoading && messages.length === 0

    return (
        <div className="h-full relative overflow-hidden w-full max-w-full">
            <ScrollArea
                className="h-full w-full"
                viewportRef={viewportRef}
                onScroll={handleScroll}
            >
                <div className="w-full max-w-full overflow-hidden">
                    {showInitialLoading ? (
                        <div className="flex flex-col items-center justify-center h-[60vh] gap-2">
                            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                            <p className="text-xs text-muted-foreground">Loading conversation…</p>
                        </div>
                    ) : (
                        <MessageList
                            messages={messages}
                            isLoading={isLoading}
                            onViewGeneration={handleViewGeneration}
                            onRegenerate={onRegenerate}
                            onRetryFailed={onRetryFailed}
                            selectedSiblings={selectedSiblings}
                            onSelectSibling={onSelectSibling}
                        />
                    )}
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
                    conversationId={conversationId}
                    onSubmit={onFormSubmit}
                    isLoading={isLoading}
                    onStop={stop}
                />
            </div>

            <LogDetails
                logId={selectedGenerationId}
                open={!!selectedGenerationId}
                onOpenChange={(open) => !open && setSelectedGenerationId(null)}
            />
        </div>
    )
}
