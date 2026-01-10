"use client"

import * as React from "react"
// import { useChat } from "@ai-sdk/react" // Removed
import { usePlaygroundChat } from "@/components/playground/use-playground-chat"
import { usePlaygroundStore, PlaygroundTab } from "@/lib/stores/playground-store"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Loader2, Send, Bot, User, StopCircle, RefreshCw, Eraser, Settings2, Sliders, Plus, ArrowUp, Copy, Check, MoreVertical } from "lucide-react"
import { cn, formatMessageTime, formatRelativeDate, normalizeDate } from "@/lib/utils"
import ReactMarkdown from 'react-markdown'
import { api } from "@/lib/api"
import { useQuery } from "@tanstack/react-query"
import { ModelSelector } from "@/components/playground/model-selector"
import { ProviderIcon } from "@/components/ProviderIcon"
import {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuGroup,
    DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"


type CursorShape = 'bar' | 'block' | 'underscore' | 'dot'

const CURSOR_STYLES: Record<CursorShape, string> = {
    bar: "bar",
    block: "block",
    underscore: "underscore",
    dot: "dot"
}

const ChatMessage = React.memo(({ message, provider, isTyping }: { message: any, provider?: string, isTyping?: boolean }) => {
    const { role, content, model, created_at, createdAt } = message
    const messageDate = created_at || createdAt
    const [copied, setCopied] = React.useState(false)

    // Attempt to handle the case where content might be a stringified JSON object
    let displayContent = content;
    if (typeof content === 'string' && content.trim().startsWith('[') && content.includes('"type":"text"')) {
        try {
            const parsed = JSON.parse(content);
            if (Array.isArray(parsed) && parsed[0]?.text) {
                displayContent = parsed[0].text;
            }
        } catch (e) {
            // ignore
        }
    }

    displayContent = typeof displayContent === 'string' ? displayContent : JSON.stringify(displayContent, null, 2)

    const onCopy = () => {
        navigator.clipboard.writeText(displayContent)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }

    return (
        <div className={cn(
            "group relative flex gap-4 px-4 py-6 hover:bg-muted/40 transition-colors w-full",
            role === "assistant" ? "" : ""
        )}>
            <Avatar className="h-8 w-8 shrink-0 bg-background border">
                {role === "assistant" ? (
                    <AvatarFallback className="bg-transparent">
                        <ProviderIcon
                            providerName={provider || "unknown"}
                            className="h-5 w-5"
                            width={20}
                            height={20}
                        />
                    </AvatarFallback>
                ) : (
                    <AvatarFallback className="bg-muted text-muted-foreground">
                        <User className="h-4 w-4" />
                    </AvatarFallback>
                )}
            </Avatar>

            <div className="flex-1 space-y-1 overflow-hidden min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                    <span className="font-semibold text-sm capitalize truncate">
                        {role === 'assistant' ? (provider ? `${provider} / ${model || 'Assistant'}` : (model || 'Assistant')) : 'User'}
                    </span>
                    <span className="text-[10px] text-muted-foreground tabular-nums select-none opacity-50 group-hover:opacity-100 transition-opacity">
                        {formatMessageTime(messageDate)}
                    </span>
                </div>

                <div className={cn(
                    "prose prose-sm dark:prose-invert max-w-none break-words relative leading-relaxed",
                    isTyping && displayContent && [
                        "[&>*:last-child]:after:content-['▋']",
                        "[&>*:last-child]:after:ml-1",
                        "[&>*:last-child]:after:animate-pulse",
                        "[&>*:last-child]:after:inline-block"
                    ]
                )}>
                    <ReactMarkdown components={{
                        pre: ({ node, ...props }) => (
                            <div className="overflow-auto w-full my-2 bg-muted/50 p-2 rounded-md">
                                <pre {...props} />
                            </div>
                        ),
                        code: ({ node, inline, className, children, ...props }: any) => {
                            return (
                                <code
                                    className={cn("bg-muted/50 rounded px-1 py-0.5", className)}
                                    {...props}
                                >
                                    {children}
                                </code>
                            )
                        }
                    }}>
                        {displayContent}
                    </ReactMarkdown>
                    {isTyping && !displayContent && (
                        <span className="animate-pulse">▋</span>
                    )}
                </div>
            </div>

            {/* Hover Actions */}
            <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1 z-10 bg-background/80 backdrop-blur-sm p-1 rounded-md border shadow-sm">
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onCopy} title="Copy">
                    {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                </Button>
            </div>
        </div>
    )
})
ChatMessage.displayName = "ChatMessage"

const DateSeparator = React.memo(({ date }: { date: string }) => (
    <div className="relative flex items-center justify-center my-6">
        <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t" />
        </div>
        <div className="relative bg-background px-3 text-xs text-muted-foreground font-medium rounded-full border">
            {formatRelativeDate(date)}
        </div>
    </div>
))
DateSeparator.displayName = "DateSeparator"

const MessageList = React.memo(({ messages, isLoading }: { messages: any[], isLoading: boolean }) => {
    const messagesEndRef = React.useRef<HTMLDivElement>(null)
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
            })
        }
        return map
    }, [modelsData])

    const scrollContainerRef = React.useRef<HTMLDivElement>(null)

    // Initial scroll
    React.useLayoutEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "instant" })
    }, [])

    // Auto crawl logic
    React.useEffect(() => {
        // Simple auto-scroll on new messages or loading state
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
    }, [messages.length, isLoading])

    // Process messages to inject date separators
    const renderItems = React.useMemo(() => {
        const items: React.ReactNode[] = []
        let lastDate: string | null = null

        messages.forEach((m: any, index: number) => {
            const mDate = m.created_at || m.createdAt
            const dateObj = normalizeDate(mDate)
            const currentDate = dateObj.toDateString() // "Mon Jan 01 2024" (Local)
            
            if (currentDate !== lastDate) {
                items.push(<DateSeparator key={`date-${currentDate}-${index}`} date={mDate} />)
                // UPDATE lastDate!
                lastDate = currentDate
            }

            items.push(
                <ChatMessage
                    key={m.id}
                    message={m}
                    provider={m.model ? modelProviderMap.get(m.model) : undefined}
                    isTyping={isLoading && index === messages.length - 1 && m.role === 'assistant'}
                />
            )
        })
        return items
    }, [messages, isLoading, modelProviderMap])

    return (
        <div className="pb-36 pt-4">
            {messages.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center p-8 text-muted-foreground opacity-50 space-y-4 pt-20">
                    <Bot className="h-12 w-12" />
                    <p>Start a conversation...</p>
                </div>
            )}

            {renderItems}

            <div ref={messagesEndRef} className="h-px" />
        </div>
    )
})
MessageList.displayName = "MessageList"

export function ChatFlow({ tabId }: { tabId: string }) {
    const { tabs, updateTab } = usePlaygroundStore()
    const tab = tabs.find(t => t.id === tabId)

    // Local settings state (sync with store if needed)
    const [temperature, setTemperature] = React.useState(tab?.temperature ?? 0.7)
    const [historyLimit, setHistoryLimit] = React.useState(tab?.historyLimit ?? 10)

    const handleModelSelect = (ids: string[]) => {
        updateTab(tabId, { modelIds: ids })
    }

    // Fetch initial messages if we have a conversationId and no messages yet
    // This is a bit tricky with useChat, so we'll use useQuery to fetch -> setInitialMessages
    const { data: initialMessagesData } = useQuery({
        queryKey: ["messages", tab?.conversationId],
        queryFn: () => api.getConversationMessages(tab?.conversationId!),
        enabled: !!tab?.conversationId && (!tab?.messages || tab.messages.length === 0),
    })

    const normalizedMessages = React.useMemo(() => {
        return tab?.messages?.map(m => ({
            ...m,
            content: typeof m.content === 'string'
                ? m.content
                : (Array.isArray(m.content) && m.content[0]?.text)
                    ? m.content[0].text
                    : typeof m.content === 'object' ? JSON.stringify(m.content) : String(m.content)
        }))
    }, [tab?.messages])

    const { messages, input, handleInputChange, handleSubmit, isLoading, setMessages } = usePlaygroundChat({
        conversationId: tab?.conversationId,
        initialMessages: normalizedMessages,
    })

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

    // Sync React Query data to useChat
    React.useEffect(() => {
        if (initialMessagesData?.items && messages.length === 0) {
            const mapped = initialMessagesData.items.map((m: any) => ({
                id: m.id,
                role: m.role as any,
                content: typeof m.content === 'string' ? m.content : (Array.isArray(m.content) && m.content[0]?.text) || JSON.stringify(m.content),
                model: m.model, // IF returned
                created_at: m.created_at
            }));
            setMessages(mapped);
        }
    }, [initialMessagesData, setMessages, messages.length])

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
            <ScrollArea className="h-full w-full">
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

ChatMessage.displayName = "ChatMessage"
