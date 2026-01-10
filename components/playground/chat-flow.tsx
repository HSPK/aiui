"use client"

import * as React from "react"
import { usePlaygroundChat } from "@/components/playground/use-playground-chat"
import { usePlaygroundStore } from "@/lib/stores/playground-store"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { ArrowUp } from "lucide-react"
import { MessageList } from "@/components/playground/message-list"
import { ChatInput } from "@/components/playground/chat-input"
import { useChatScroll, usePaginatedMessages } from "@/components/playground/hooks"

export function ChatFlow({ tabId }: { tabId: string }) {
    const { tabs, updateTab } = usePlaygroundStore()
    const tab = tabs.find(t => t.id === tabId)

    // Local settings state
    const [temperature, setTemperature] = React.useState<number | undefined>(tab?.temperature)
    const [historyLimit, setHistoryLimit] = React.useState(tab?.historyLimit ?? 10)
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

    // Handle model selection
    const handleModelSelect = (ids: string[]) => {
        updateTab(tabId, { modelIds: ids })
    }

    // Handle form submit
    const onFormSubmit = (e: React.FormEvent) => {
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
    }

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
                    created_at: m.created_at || new Date().toISOString()
                }
            })
            updateTab(tabId, { messages: storeMessages as any })
        }, 1000)
        return () => clearTimeout(timeout)
    }, [messages, updateTab, tabId, tab?.conversationId])

    return (
        <div className="h-full relative overflow-hidden">
            <ScrollArea
                className="h-full w-full"
                viewportRef={viewportRef}
                onScroll={handleScroll}
            >
                <MessageList messages={messages} isLoading={isLoading} />
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
                    onClearMessages={() => setMessages([])}
                    hasMessages={messages.length > 0}
                    temperature={temperature}
                    onTemperatureChange={(val) => {
                        setTemperature(val)
                        updateTab(tabId, { temperature: val })
                    }}
                    historyLimit={historyLimit}
                    onHistoryLimitChange={(val) => {
                        setHistoryLimit(val)
                        updateTab(tabId, { historyLimit: val })
                    }}
                    reasoningEffort={reasoningEffort}
                    onReasoningEffortChange={setReasoningEffort}
                />
            </div>
        </div>
    )
}
