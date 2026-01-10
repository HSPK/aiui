"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Check, Copy, User } from "lucide-react"
import { cn, formatMessageTime } from "@/lib/utils"
import ReactMarkdown from 'react-markdown'
import { ProviderIcon } from "@/components/ProviderIcon"

export const ChatMessage = React.memo(({ message, provider, isTyping }: { message: any, provider?: string, isTyping?: boolean }) => {
    const { role, content, model_id, created_at, createdAt } = message
    const messageDate = created_at || createdAt
    const [copied, setCopied] = React.useState(false)

    // Memoize the JSON parsing/display calculation to avoid doing it on every render
    const displayContent = React.useMemo(() => {
        let dc = content;
        if (typeof content === 'string' && content.trim().startsWith('[') && content.includes('"type":"text"')) {
            try {
                const parsed = JSON.parse(content);
                if (Array.isArray(parsed) && parsed[0]?.text) {
                    dc = parsed[0].text;
                }
            } catch (e) {
                // ignore
            }
        }
        return typeof dc === 'string' ? dc : JSON.stringify(dc, null, 2)
    }, [content])

    const onCopy = React.useCallback(() => {
        navigator.clipboard.writeText(displayContent)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }, [displayContent])

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
                    <span className="font-semibold text-sm truncate">
                        {role === 'assistant' ? (provider ? `${provider} / ${model_id || 'Assistant'}` : (model_id || 'Assistant')) : 'User'}
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
