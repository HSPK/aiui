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
import { Loader2, Send, Bot, User, StopCircle, RefreshCw, Eraser, Settings2, Sliders, Plus, ArrowUp } from "lucide-react"
import { cn } from "@/lib/utils"
import ReactMarkdown from 'react-markdown'
import { api } from "@/lib/api"
import { useQuery } from "@tanstack/react-query"
import { ModelSelector } from "@/components/playground/model-selector"
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

const ChatMessage = React.memo(({ role, content, model, isTyping, cursorShape = 'block' }: { role: string, content: any, model?: string, isTyping?: boolean, cursorShape?: CursorShape }) => {
    // Attempt to handle the case where content might be a stringified JSON object
    // (Workaround for potential data synchronization issues)
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

    return (
        <div className={cn("flex gap-4 p-4", role === "assistant" ? "bg-muted/50" : "bg-background")}>
            <Avatar className="h-8 w-8 border">
                {role === "assistant" ? (
                    <AvatarFallback className="bg-primary text-primary-foreground"><Bot className="h-4 w-4" /></AvatarFallback>
                ) : (
                    <AvatarFallback><User className="h-4 w-4" /></AvatarFallback>
                )}
            </Avatar>
            <div className="flex-1 space-y-2 overflow-hidden">
                <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm capitalize">{role}</span>
                    {model && <Badge variant="outline" className="text-xs font-normal text-muted-foreground">{model}</Badge>}
                </div>
                <div className={cn(
                    "prose prose-sm dark:prose-invert max-w-none break-words relative",
                    isTyping && displayContent && [
                        "[&>*:last-child]:after:content-['▋']",
                        "[&>*:last-child]:after:ml-1",
                        "[&>*:last-child]:after:animate-pulse",
                        "[&>*:last-child]:after:inline-block"
                    ]
                )}>
                    <ReactMarkdown>{displayContent}</ReactMarkdown>
                    {isTyping && !displayContent && (
                        <span className="animate-pulse">▋</span>
                    )}
                </div>
            </div>
        </div>
    )
})
ChatMessage.displayName = "ChatMessage"

const MessageList = React.memo(({ messages, isLoading }: { messages: any[], isLoading: boolean }) => {
    const messagesEndRef = React.useRef<HTMLDivElement>(null)

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
    }

    React.useEffect(() => {
        scrollToBottom()
    }, [messages, isLoading])

    return (
        <div className="pb-4">
            {messages.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center p-8 text-muted-foreground opacity-50 space-y-4 pt-20">
                    <Bot className="h-12 w-12" />
                    <p>Start a conversation...</p>
                </div>
            )}
            {messages.map((m: any, index: number) => (
                <ChatMessage
                    key={m.id}
                    role={m.role}
                    content={m.content}
                    model={m.model}
                    isTyping={isLoading && index === messages.length - 1 && m.role === 'assistant'}
                />
            ))}
            <div ref={messagesEndRef} />
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
                model: m.model // IF returned
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
        <div className="flex flex-col h-full relative overflow-hidden">
            <ScrollArea className="flex-1 min-h-0 w-full">
                <MessageList messages={messages} isLoading={isLoading} />
            </ScrollArea>

            <div className="p-4 bg-background z-10 w-full flex-none">
                <form onSubmit={onFormSubmit} className="flex flex-col gap-2 w-full mx-auto">
                    <div className="flex items-end gap-2 bg-muted/20 border rounded-md px-2 py-2 focus-within:border-primary/20 transition-all">
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
