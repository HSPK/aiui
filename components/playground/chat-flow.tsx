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
import { Loader2, Send, Bot, User, StopCircle, RefreshCw, Eraser, Settings2, Sliders } from "lucide-react"
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

const CURSOR_CHARS: Record<CursorShape, string> = {
    bar: '│',
    block: '▋',
    underscore: '_',
    dot: '●'
}

function ChatMessage({ role, content, model, isTyping, cursorShape = 'block' }: { role: string, content: any, model?: string, isTyping?: boolean, cursorShape?: CursorShape }) {
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

    if (isTyping) {
        displayContent += (CURSOR_CHARS[cursorShape] || '▋');
    }

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
                <div className="prose prose-sm dark:prose-invert max-w-none break-words relative">
                    <ReactMarkdown>{displayContent}</ReactMarkdown>
                </div>
            </div>
        </div>
    )
}

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


    const messagesEndRef = React.useRef<HTMLDivElement>(null)

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
    }

    React.useEffect(() => {
        scrollToBottom()
    }, [messages, isLoading])

    return (
        <div className="flex flex-col h-full relative overflow-hidden">
            <ScrollArea className="flex-1 min-h-0 w-full">
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
                    {isLoading && (
                        <div className="p-4 pl-16">
                            <div className="flex items-center gap-2 text-muted-foreground text-sm">
                                <Loader2 className="h-3 w-3 animate-spin" /> Thinking...
                            </div>
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                </div>
            </ScrollArea>

            <div className="p-4 bg-background/95 backdrop-blur z-10 w-full max-w-4xl mx-auto flex-none">
                <form onSubmit={onFormSubmit} className="relative flex flex-col gap-0 border rounded-xl overflow-hidden shadow-sm bg-background focus-within:ring-1 focus-within:ring-ring">
                    <div className="flex items-center gap-1 p-2 border-b bg-muted/20">
                        <ModelSelector
                            selectedModelIds={tab?.modelIds || []}
                            onModelSelect={handleModelSelect}
                            side="top"
                            align="start"
                            trigger={
                                <Button variant="ghost" size="sm" className="h-7 gap-2 px-2 text-muted-foreground hover:text-foreground font-normal">
                                    {(tab?.modelIds?.length || 0) > 0 ? (
                                        <>
                                            <span className="truncate max-w-[150px] text-xs">
                                                {(tab?.modelIds?.length || 0) > 1
                                                    ? `${tab?.modelIds?.length} models`
                                                    : tab?.modelIds?.[0]}
                                            </span>
                                        </>
                                    ) : <span className="text-xs">Select Model</span>}
                                </Button>
                            }
                        />

                        <div className="flex-1" />

                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground">
                                    <Settings2 className="h-3.5 w-3.5" />
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
                    </div>

                    <Textarea
                        value={input}
                        onChange={handleInputChange}
                        placeholder="Type a message..."
                        className="min-h-[60px] max-h-[300px] border-0 focus-visible:ring-0 resize-none px-4 py-3 bg-transparent shadow-none"
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault()
                                onFormSubmit(e as any)
                            }
                        }}
                    />

                    <div className="flex justify-between items-center p-2 pt-0">
                        <div className="flex items-center gap-2">
                            {/* Placeholder for future tools */}
                        </div>
                        <div className="flex items-center gap-2">
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => setMessages([])}
                                title="Clear history"
                                disabled={isLoading || messages.length === 0}
                                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            >
                                <Eraser className="h-4 w-4" />
                            </Button>
                            <Button
                                type="submit"
                                size="icon"
                                disabled={isLoading || !input?.trim() || (tab?.modelIds?.length || 0) === 0}
                                className="h-8 w-8"
                            >
                                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                            </Button>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    )
}
