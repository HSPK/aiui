"use client"

import * as React from "react"
// import { useChat } from "@ai-sdk/react" // Removed
import { usePlaygroundChat } from "@/components/playground/use-playground-chat"
import { usePlaygroundStore } from "@/lib/stores/playground-store"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Loader2, Bot, Eraser, Settings2, Plus, ArrowUp } from "lucide-react"
import { cn } from "@/lib/utils"
import { api } from "@/lib/api"
import { useQuery } from "@tanstack/react-query"
import { ModelSelector } from "@/components/playground/model-selector"
import { MessageList } from "@/components/playground/message-list"
import {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export function ChatFlow({ tabId }: { tabId: string }) {
    const { tabs, updateTab } = usePlaygroundStore()
    const tab = tabs.find(t => t.id === tabId)

    // Local settings state (sync with store if needed)
    const [temperature, setTemperature] = React.useState(tab?.temperature ?? 0.7)
    const [historyLimit, setHistoryLimit] = React.useState(tab?.historyLimit ?? 10)

    const handleModelSelect = (ids: string[]) => {
        updateTab(tabId, { modelIds: ids })
    }

    const normalizedMessages = React.useMemo(() => {
        return tab?.messages?.map(m => ({
            ...m,
            id: m.id,
            role: m.role as any,
            content: typeof m.content === 'string' ? m.content : (Array.isArray(m.content) && m.content[0]?.text) ? m.content[0].text : String(m.content)
        })) || []
    }, [tab?.messages])

    const { messages, input, handleInputChange, handleSubmit, isLoading, setMessages } = usePlaygroundChat({
        conversationId: tab?.conversationId,
        initialMessages: normalizedMessages,
    })

    // Pagination State
    const [isLoadingMore, setIsLoadingMore] = React.useState(false)
    const [hasMore, setHasMore] = React.useState(true)
    const pageRef = React.useRef(2) // Start fetching from page 2 (history)
    const isFirstLoadRef = React.useRef(true)

    // Helper to transform API message to UI message
    const transformMessage = React.useCallback((m: any) => ({
        id: m.id,
        role: m.role,
        content: typeof m.content === 'string' ? m.content : (Array.isArray(m.content) && m.content[0]?.text) || JSON.stringify(m.content),
        model: m.model,
        created_at: m.created_at
    }), [])

    // Initial Load / Sync
    React.useEffect(() => {
        // Sync pageRef based on loaded messages (if we loaded from store)
        if (isFirstLoadRef.current && messages.length > 0) {
            isFirstLoadRef.current = false
            const p = Math.floor(messages.length / 20) + 1
            pageRef.current = p
        }

        // If no messages at all, but we have an ID, fetch!
        if (tab?.conversationId && messages.length === 0 && isFirstLoadRef.current) {
            isFirstLoadRef.current = false;

            const fetchInitial = async () => {
                try {
                    const res = await api.getConversationMessages(tab.conversationId!, {
                        page: 1,
                        page_size: 20,
                        sort: "-created_at"
                    });

                    if (res.items.length > 0) {
                        const newMsgs = res.items.reverse().map(transformMessage);
                        setMessages(newMsgs);
                        setHasMore(res.items.length >= 20);
                        pageRef.current = 2;
                    } else {
                        setHasMore(false);
                    }
                } catch (e) {
                    console.error("Failed to load initial messages", e)
                }
            }
            fetchInitial();
        }
    }, [tab?.conversationId, messages.length, setMessages, transformMessage])

    // Load More Function
    const loadMoreMessages = React.useCallback(async () => {
        if (!hasMore || isLoadingMore || !tab?.conversationId) return

        setIsLoadingMore(true)
        const scrollContainer = viewportRef.current
        const oldHeight = scrollContainer?.scrollHeight ?? 0
        const oldTop = scrollContainer?.scrollTop ?? 0

        try {
            const res = await api.getConversationMessages(tab.conversationId, {
                page: pageRef.current,
                page_size: 20,
                sort: '-created_at'
            })

            if (res.items.length < 20) setHasMore(false)
            if (res.items.length > 0) {
                pageRef.current += 1
                const newMessages = res.items.reverse().map(transformMessage)

                // Prepend messages with deduplication
                setMessages(prev => {
                    // Create a Set of existing IDs for O(1) lookup
                    const existingIds = new Set(prev.map(m => m.id))
                    // Filter out any new messages that already exist
                    const uniqueNewMessages = newMessages.filter(m => !existingIds.has(m.id))

                    if (uniqueNewMessages.length === 0) return prev

                    return [...uniqueNewMessages, ...prev]
                })

                // Restore scroll position
                // We need to wait for the DOM to update. 
                // Using MessageList's internal ref might be better but here we control the scroll area.
                requestAnimationFrame(() => {
                    if (scrollContainer) {
                        // The scroll height increases by the height of new content.
                        // We want to keep the scrollTop at the same *relative* position to the content that was there.
                        // New scrollTop = (newScrollHeight - oldScrollHeight) + oldTop
                        const newHeight = scrollContainer.scrollHeight
                        const heightDiff = newHeight - oldHeight
                        scrollContainer.scrollTop = heightDiff + oldTop
                    }
                })
            }
        } catch (e) {
            console.error("Failed to load more messages", e)
        } finally {
            setIsLoadingMore(false)
        }
    }, [hasMore, isLoadingMore, tab?.conversationId, setMessages, transformMessage])

    // Scroll management
    const viewportRef = React.useRef<HTMLDivElement>(null)
    const currentScrollRef = React.useRef(0) // Track scroll without re-rendering
    const lastMessageIdRef = React.useRef<string | null>(null)

    // Save scroll position on unmount
    React.useEffect(() => {
        return () => {
            if (currentScrollRef.current > 0) {
                // accessing ref directly in cleanup is safe for this ref
                // but we need to capture the stable updateTab/tabId function/value?
                // Actually, due to closure stale-ness in cleanup of empty-dep effect, 
                // we technically need a ref for updateTab too if we want to be 100% correct, 
                // but usually tabId is constant for the component instance.
                // However, updateTab comes from store hook, might change? 
                // Let's use a specialized effect that updates a ref with the latest 'save' function.
            }
        }
    }, [])

    // Dedicated effect to handle saving on unmount
    const saveScroll = React.useCallback(() => {
        if (currentScrollRef.current > 0) {
            updateTab(tabId, { scrollPosition: currentScrollRef.current })
        }
    }, [tabId, updateTab])

    const saveScrollRef = React.useRef(saveScroll)
    React.useLayoutEffect(() => {
        saveScrollRef.current = saveScroll
    })

    React.useEffect(() => {
        return () => {
            saveScrollRef.current()
        }
    }, [])
    React.useLayoutEffect(() => {
        const viewport = viewportRef.current

        // Wait for messages to be populated if this is first load
        if (!viewport) return

        if (typeof tab?.scrollPosition === 'number') {
            viewport.scrollTop = tab.scrollPosition
        } else if (messages.length > 0) {
            // Default to bottom if we have messages and no saved position
            // This needs to happen AFTER messages are rendered.
            // Since this effect runs on mount, and messages might be set asynchronously in useEffect,
            // we need to trigger this again when messages change IF we haven't set a position yet.
            viewport.scrollTop = viewport.scrollHeight
        }
    }, [tab?.scrollPosition]) // Depend on scrollPosition changing (unlikely) or just mount?

    // Additional effect to handle "Initial Bottom Scroll" when messages first appear
    // and no previous position was saved.
    const hasScrolledToBottomRef = React.useRef(false)
    React.useEffect(() => {
        // Only if we haven't restored a specific position
        if (typeof tab?.scrollPosition !== 'number' && !hasScrolledToBottomRef.current && messages.length > 0) {
            if (viewportRef.current) {
                viewportRef.current.scrollTop = viewportRef.current.scrollHeight
                hasScrolledToBottomRef.current = true
            }
        }
    }, [messages.length, tab?.scrollPosition])

    // Initialize lastMessageIdRef to prevent auto-scrolling on mount if messages exist
    React.useEffect(() => {
        if (messages.length > 0 && !lastMessageIdRef.current) {
            lastMessageIdRef.current = messages[messages.length - 1].id
        }
    }, [messages])

    // Smart Auto-Scroll (Only for new messages at the bottom)
    React.useEffect(() => {
        const viewport = viewportRef.current
        if (!viewport || messages.length === 0) return

        const lastMsg = messages[messages.length - 1]

        // If the last message ID changed, it implies a new message was added to the END.
        if (lastMsg.id !== lastMessageIdRef.current) {
            lastMessageIdRef.current = lastMsg.id
            viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'smooth' })
        }
    }, [messages])

    const handleScroll = React.useCallback((e: React.UIEvent<HTMLDivElement>) => {
        const target = e.currentTarget
        currentScrollRef.current = target.scrollTop // Update ref synchronously

        // Check for top reach to load more (threshold 50px)
        if (target.scrollTop < 50 && hasMore && !isLoadingMore && messages.length > 0) {
            loadMoreMessages()
        }
    }, [hasMore, isLoadingMore, messages.length, loadMoreMessages])

    const onFormSubmit = (e: React.FormEvent) => {
        handleSubmit(e, {
            models: tab?.modelIds || ["gpt-3.5-turbo"], // Default fallback
            config: {
                stream: true,
                temperature,
                conv_history_limit: historyLimit
            }
        })
    }

    // Sync local messages to store to persist when switching tabs
    // This might be performance heavy, so maybe debounce or only on unmount?
    // For now, let's trust useChat's internal state if the component isn't unmounted.
    // BUT the PlaygroundTabs component likely mounts/unmounts tabs.
    // So we should sync to store.
    React.useEffect(() => {
        // We only want to save significant changes.
        // Actually, let's update store only when leaving valid data.
        const timeout = setTimeout(() => {
            // Convert 'ai' SDK messages to our Message type format roughly
            // We can't perfectly match because 'ai' SDK messages are simpler.
            // But for this "client-side history", it's enough.
            const storeMessages = messages.map((m: any) => {
                // Check if content is already wrapped or if it's a string
                let contentVal = m.content;
                // If it's already an array with type: text, don't wrap it again?
                // But normalizedMessages unwraps it. So messages state SHOULD be string.
                // However, let's be safe.
                if (typeof contentVal === 'string') {
                    // Good
                } else if (Array.isArray(contentVal) && contentVal[0]?.text) {
                    contentVal = contentVal[0].text // Unwrap for now, then re-wrap below
                } else if (typeof contentVal === 'object' && contentVal !== null) {
                    // If it's some other object, stringify it to prevent [object Object]
                    contentVal = JSON.stringify(contentVal)
                }

                return {
                    id: m.id,
                    conversation_id: tab?.conversationId || "",
                    role: m.role as any,
                    content: [{ type: "text", text: String(contentVal) }],
                    model: m.model,
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
                <form onSubmit={onFormSubmit} className="flex flex-col gap-2 w-full mx-auto max-w-4xl">
                    <div className="flex items-end gap-2 bg-background border rounded-2xl px-2 py-2 focus-within:ring-1 focus-within:ring-ring transition-all shadow-lg">
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="rounded-full h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                            title="Add attachment"
                        >
                            <Plus className="h-5 w-5" />
                        </Button>

                        <Textarea
                            value={input}
                            onChange={handleInputChange}
                            placeholder={`Message ${tab?.modelIds?.[0] || 'AI'}...`}
                            className="min-h-[32px] max-h-[200px] border-0 focus-visible:ring-0 resize-none p-0 py-[6px] bg-transparent dark:bg-transparent shadow-none flex-1 text-sm leading-[20px]"
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault()
                                    onFormSubmit(e as any)
                                }
                            }}
                        />

                        <div className="flex items-center gap-1 shrink-0">
                            <ModelSelector
                                selectedModelIds={tab?.modelIds || []}
                                onModelSelect={handleModelSelect}
                                side="top"
                                align="end"
                                trigger={
                                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
                                        <Bot className="h-5 w-5" />
                                    </Button>
                                }
                            />

                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
                                        <Settings2 className="h-5 w-5" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent className="w-80 p-4" align="end">
                                    <div className="space-y-4">
                                        <h4 className="font-medium leading-none">Configuration</h4>
                                        <div className="grid gap-2">
                                            <Label htmlFor="temperature">Temperature: {temperature}</Label>
                                            <Input
                                                id="temperature"
                                                type="number"
                                                min={0}
                                                max={2}
                                                step={0.1}
                                                value={temperature}
                                                onChange={(e) => {
                                                    const val = parseFloat(e.target.value)
                                                    setTemperature(val)
                                                    updateTab(tabId, { temperature: val })
                                                }}
                                            />
                                        </div>
                                        <div className="grid gap-2">
                                            <Label htmlFor="history">History Limit</Label>
                                            <Input
                                                id="history"
                                                type="number"
                                                min={0}
                                                value={historyLimit}
                                                onChange={(e) => {
                                                    const val = parseInt(e.target.value)
                                                    setHistoryLimit(val)
                                                    updateTab(tabId, { historyLimit: val })
                                                }}
                                            />
                                        </div>
                                    </div>
                                </DropdownMenuContent>
                            </DropdownMenu>

                            {messages.length > 0 && (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => setMessages([])}
                                    title="Clear history"
                                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                >
                                    <Eraser className="h-5 w-5" />
                                </Button>
                            )}

                            {(input?.trim() || isLoading) && (
                                <Button
                                    type="submit"
                                    size="icon"
                                    disabled={isLoading || !input?.trim()}
                                    className={cn(
                                        "h-8 w-8 rounded-full ml-1",
                                        isLoading ? "bg-muted text-muted-foreground" : "bg-primary text-primary-foreground"
                                    )}
                                >
                                    {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-5 w-5" />}
                                </Button>
                            )}
                        </div>
                    </div>
                </form>
            </div>
        </div>
    )
}
