"use client"

import * as React from "react"
import { useChat } from "@ai-sdk/react"
import { usePlaygroundStore, PlaygroundTab } from "@/lib/stores/playground-store"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Loader2, Send, Bot, User, StopCircle, RefreshCw, Eraser } from "lucide-react"
import { cn } from "@/lib/utils"
// @ts-ignore
import ReactMarkdown from 'react-markdown'
import { api } from "@/lib/api"
import { useQuery } from "@tanstack/react-query"

function ChatMessage({ role, content }: { role: string, content: string }) {
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
                </div>
                <div className="prose prose-sm dark:prose-invert max-w-none break-words">
                    <ReactMarkdown>{content}</ReactMarkdown>
                </div>
            </div>
        </div>
    )
}

export function ChatFlow({ tabId }: { tabId: string }) {
    const { tabs, updateTab } = usePlaygroundStore()
    const tab = tabs.find(t => t.id === tabId)

    // Fetch initial messages if we have a conversationId and no messages yet
    // This is a bit tricky with useChat, so we'll use useQuery to fetch -> setInitialMessages
    const { data: initialMessagesData } = useQuery({
        queryKey: ["messages", tab?.conversationId],
        queryFn: () => api.getConversationMessages(tab?.conversationId!),
        enabled: !!tab?.conversationId && tab.messages.length === 0,
    })

    const { messages, input, handleInputChange, handleSubmit, stop, isLoading, setMessages, reload } = useChat({
        api: "/api/chat",
        id: tabId,
        body: {
            conversation_id: tab?.conversationId,
            model: tab?.modelId || "gpt-3.5-turbo", // Default
            temperature: tab?.temperature,
            max_tokens: tab?.maxTokens,
            // Pass user ID etc? Handled by backend auth usually
        },
        initialMessages: tab?.messages.map(m => ({
            id: m.id,
            role: m.role as any,
            content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content), // Simplify for now
        })) || [],
        onFinish: (message) => {
            // Update the tab with the new messages so switching tabs preserves state
            // But verify how useChat handles this.
        },
        onError: (err) => {
            console.error("Chat error", err)
        }
    })

    // Sync React Query data to useChat
    React.useEffect(() => {
        if (initialMessagesData?.items && messages.length === 0) {
            const mapped = initialMessagesData.items.map((m: any) => ({
                id: m.id,
                role: m.role as any,
                content: typeof m.content === 'string' ? m.content : (Array.isArray(m.content) && m.content[0]?.text) || JSON.stringify(m.content),
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
            const storeMessages = messages.map(m => ({
                id: m.id,
                conversation_id: tab?.conversationId || "",
                role: m.role as any,
                content: [{ type: "text", text: m.content }],
                is_active: true,
                created_at: new Date().toISOString()
            }))
            updateTab(tabId, { messages: storeMessages as any })
        }, 1000)
        return () => clearTimeout(timeout)
    }, [messages, updateTab, tabId, tab?.conversationId])


    return (
        <div className="flex flex-col h-full relative">
            <ScrollArea className="flex-1">
                <div className="pb-20">
                    {messages.length === 0 && (
                        <div className="h-full flex flex-col items-center justify-center p-8 text-muted-foreground opacity-50 space-y-4 pt-20">
                            <Bot className="h-12 w-12" />
                            <p>Start a conversation...</p>
                        </div>
                    )}
                    {messages.map(m => (
                        <ChatMessage key={m.id} role={m.role} content={m.content} />
                    ))}
                    {isLoading && (
                        <div className="p-4 pl-16">
                            <div className="flex items-center gap-2 text-muted-foreground text-sm">
                                <Loader2 className="h-3 w-3 animate-spin" /> Thinking...
                            </div>
                        </div>
                    )}
                </div>
            </ScrollArea>

            <div className="p-4 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
                <form onSubmit={handleSubmit} className="relative max-w-4xl mx-auto flex gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => setMessages([])}
                        title="Clear history"
                        disabled={isLoading || messages.length === 0}
                    >
                        <Eraser className="h-4 w-4" />
                    </Button>
                    <Textarea
                        value={input}
                        onChange={handleInputChange}
                        placeholder="Type a message..."
                        className="min-h-[44px] max-h-[200px] resize-none flex-1"
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                handleSubmit(e as any);
                            }
                        }}
                    />
                    {isLoading ? (
                        <Button type="button" size="icon" variant="destructive" onClick={stop}>
                            <StopCircle className="h-4 w-4" />
                        </Button>
                    ) : (
                        <Button type="submit" size="icon" disabled={!input?.trim()}>
                            <Send className="h-4 w-4" />
                        </Button>
                    )}
                </form>
            </div>
        </div>
    )
}
