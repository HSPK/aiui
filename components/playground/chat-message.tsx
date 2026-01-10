"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Check, Copy, ChevronDown, ChevronRight, ThumbsUp, ThumbsDown, Info } from "lucide-react"
import { cn, formatMessageTime } from "@/lib/utils"
import ReactMarkdown from 'react-markdown'
import { ProviderIcon } from "@/components/ProviderIcon"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { useSettingsStore } from "@/lib/stores/settings-store"
import { api } from "@/lib/api"
import { toast } from "sonner"

interface ChatMessageProps {
    message: any
    provider?: string
    isTyping?: boolean
    onViewGeneration?: (generationId: string) => void
}

export const ChatMessage = React.memo(({ message, provider, isTyping, onViewGeneration }: ChatMessageProps) => {
    const { role, content, reasoning_content, model_id, created_at, createdAt, generation_id, rating: initialRating } = message
    const messageDate = created_at || createdAt
    const [copied, setCopied] = React.useState(false)
    const [isReasoningOpen, setIsReasoningOpen] = React.useState(true)
    const [rating, setRating] = React.useState<"up" | "down" | "none">(initialRating || "none")
    const [isRating, setIsRating] = React.useState(false)
    const { userName, userAvatar } = useSettingsStore()

    // Sync rating state when initialRating changes (e.g., from server)
    React.useEffect(() => {
        if (initialRating) {
            setRating(initialRating)
        }
    }, [initialRating])

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

    const handleRate = React.useCallback(async (newRating: "up" | "down") => {
        if (!message.id || isRating) return

        const targetRating = rating === newRating ? "none" : newRating
        setIsRating(true)

        try {
            await api.rateMessage(message.id, targetRating)
            setRating(targetRating)
        } catch (err) {
            toast.error("Failed to rate message")
        } finally {
            setIsRating(false)
        }
    }, [message.id, rating, isRating])

    const handleViewGeneration = React.useCallback(() => {
        if (generation_id && onViewGeneration) {
            onViewGeneration(generation_id)
        }
    }, [generation_id, onViewGeneration])

    return (
        <div className={cn(
            "group relative flex gap-4 px-4 py-6 hover:bg-muted/30 transition-colors w-full",
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
                    <AvatarFallback className="bg-muted text-lg">
                        {userAvatar}
                    </AvatarFallback>
                )}
            </Avatar>

            <div className="flex-1 overflow-hidden min-w-0">
                <div className="space-y-1">
                    <div className="flex items-center gap-2 min-w-0">
                        <span className="font-semibold text-sm truncate">
                            {role === 'assistant' ? (provider ? `${provider} / ${model_id || 'Assistant'}` : (model_id || 'Assistant')) : userName}
                        </span>
                        <span className="text-[10px] text-muted-foreground tabular-nums select-none opacity-50 group-hover:opacity-100 transition-opacity">
                            {formatMessageTime(messageDate)}
                        </span>
                    </div>

                    {/* Reasoning Block */}
                    {reasoning_content && (
                        <Collapsible
                            open={isReasoningOpen}
                            onOpenChange={setIsReasoningOpen}
                            className="mb-2"
                        >
                            <CollapsibleTrigger asChild>
                                <Button variant="ghost" size="sm" className="h-6 p-2 hover:bg-transparent text-muted-foreground text-xs flex items-center gap-2 w-auto justify-start font-normal opacity-70 hover:opacity-100 transition-opacity">
                                    <span className="flex items-center justify-center w-4 h-4 rounded bg-muted/50">
                                        {isReasoningOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                                    </span>
                                    {isTyping && (!content || content.length === 0) ? "Reasoning..." : "Reasoning process"}
                                </Button>
                            </CollapsibleTrigger>
                            <CollapsibleContent>
                                <div className={cn(
                                    "mt-2 pl-4 border-l-2 border-border/40 ml-2",
                                    "prose prose-sm prose-neutral dark:prose-invert max-w-none break-words leading-relaxed",
                                    "text-xs text-muted-foreground"
                                )}>
                                    <ReactMarkdown
                                        components={{
                                            pre: ({ node, ...props }) => (
                                                <div className="overflow-auto w-full my-2 bg-background/50 p-2 rounded-md border text-xs">
                                                    <pre {...props} />
                                                </div>
                                            ),
                                            code: ({ node, inline, className, children, ...props }: any) => {
                                                return (
                                                    <code
                                                        className={cn("bg-background/50 rounded px-1 py-0.5 text-xs", className)}
                                                        {...props}
                                                    >
                                                        {children}
                                                    </code>
                                                )
                                            }
                                        }}
                                    >
                                        {reasoning_content}
                                    </ReactMarkdown>
                                </div>
                            </CollapsibleContent>
                        </Collapsible>
                    )}

                    <div className={cn(
                        "prose prose-sm dark:prose-invert max-w-none break-words relative leading-relaxed",
                        isTyping && displayContent && "typing-active"
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
                            <span className="typing-cursor text-primary">▋</span>
                        )}
                    </div>
                </div>
            </div>

            {/* Message Actions - Floating at bottom border */}
            <div className="absolute bottom-0 left-[4.5rem] translate-y-1/2 flex items-center gap-1.5 z-10">
                {/* Copy button - only show on hover */}
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground bg-background border border-border/50 shadow-sm rounded-md hover:bg-muted/50 opacity-0 group-hover:opacity-100 transition-opacity duration-150"
                    onClick={onCopy}
                    title="Copy"
                >
                    {copied ? (
                        <Check className="h-3.5 w-3.5 text-green-500" />
                    ) : (
                        <Copy className="h-3.5 w-3.5" />
                    )}
                </Button>

                {/* Rating buttons - only for assistant messages after generation is complete (has generation_id) */}
                {role === "assistant" && generation_id && (
                    <>
                        <Button
                            variant="ghost"
                            size="sm"
                            className={cn(
                                "h-6 w-6 p-0 rounded-md border border-border/50 shadow-sm transition-opacity duration-150",
                                rating === "up"
                                    ? "text-green-500 bg-green-500/10 hover:bg-green-500/20 border-green-500/30 opacity-100"
                                    : "text-muted-foreground hover:text-foreground bg-background hover:bg-muted/50 opacity-0 group-hover:opacity-100"
                            )}
                            onClick={() => handleRate("up")}
                            disabled={isRating}
                            title="Good response"
                        >
                            <ThumbsUp className={cn("h-3.5 w-3.5", rating === "up" && "fill-current")} />
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            className={cn(
                                "h-6 w-6 p-0 rounded-md border border-border/50 shadow-sm transition-opacity duration-150",
                                rating === "down"
                                    ? "text-red-500 bg-red-500/10 hover:bg-red-500/20 border-red-500/30 opacity-100"
                                    : "text-muted-foreground hover:text-foreground bg-background hover:bg-muted/50 opacity-0 group-hover:opacity-100"
                            )}
                            onClick={() => handleRate("down")}
                            disabled={isRating}
                            title="Bad response"
                        >
                            <ThumbsDown className={cn("h-3.5 w-3.5", rating === "down" && "fill-current")} />
                        </Button>
                    </>
                )}

                {/* View generation details - only show on hover */}
                {generation_id && onViewGeneration && (
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground bg-background border border-border/50 shadow-sm rounded-md hover:bg-muted/50 opacity-0 group-hover:opacity-100 transition-opacity duration-150"
                        onClick={handleViewGeneration}
                        title="View generation details"
                    >
                        <Info className="h-3.5 w-3.5" />
                    </Button>
                )}
            </div>
        </div>
    )
})
ChatMessage.displayName = "ChatMessage"
