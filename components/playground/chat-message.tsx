"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Check, Copy, ChevronDown, ChevronRight, ChevronLeft, ThumbsUp, ThumbsDown, Info, RotateCcw } from "lucide-react"
import { cn, formatMessageTime } from "@/lib/utils"
import ReactMarkdown from 'react-markdown'
import { ProviderIcon } from "@/components/ProviderIcon"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { useSettingsStore } from "@/lib/stores/settings-store"
import { api } from "@/lib/api"
import { toast } from "sonner"
import { CodeBlock, InlineCode } from "./code-block"

interface ChatMessageProps {
    message: any
    provider?: string
    isTyping?: boolean
    onViewGeneration?: (generationId: string) => void
    // Retry/regenerate support
    isLastAssistant?: boolean
    onRetry?: () => void
    isLoading?: boolean
    // Sibling navigation (multiple responses with same parent)
    siblingIndex?: number  // 0-based index in siblings array
    siblingCount?: number  // total siblings
    onNavigateSibling?: (direction: 'prev' | 'next') => void
}

export const ChatMessage = React.memo(({
    message,
    provider,
    isTyping,
    onViewGeneration,
    isLastAssistant,
    onRetry,
    isLoading,
    siblingIndex,
    siblingCount,
    onNavigateSibling
}: ChatMessageProps) => {
    const { role, content, reasoning_content, model_id, created_at, createdAt, generation_id, rating: initialRating } = message
    const hasSiblings = siblingCount !== undefined && siblingCount > 1
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
            "group relative flex gap-3 sm:gap-4 px-3 sm:px-4 py-4 sm:py-6 hover:bg-muted/30 transition-colors w-full"
        )}>
            <Avatar className="h-7 w-7 sm:h-8 sm:w-8 shrink-0 bg-background border">
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

            <div className="flex-1 min-w-0">
                <div className="space-y-1">
                    <div className="flex items-center gap-2 min-w-0">
                        <span className="font-semibold text-sm md:truncate md:whitespace-nowrap break-all">
                            {role === 'assistant' ? (provider ? `${provider} / ${model_id || 'Assistant'}` : (model_id || 'Assistant')) : userName}
                        </span>
                        <span suppressHydrationWarning className="text-[10px] text-muted-foreground tabular-nums select-none opacity-50 group-hover:opacity-100 transition-opacity">
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
                                            pre: ({ children }) => <>{children}</>,
                                            code: ({ node, inline, className, children, ...props }: any) => {
                                                const match = /language-(\w+)/.exec(className || '')
                                                const codeString = String(children).replace(/\n$/, '')

                                                if (!inline && match) {
                                                    return <CodeBlock language={match[1]} value={codeString} />
                                                }

                                                if (!inline && codeString.includes('\n')) {
                                                    return <CodeBlock language="text" value={codeString} />
                                                }

                                                return <InlineCode {...props}>{children}</InlineCode>
                                            }
                                        }}
                                    >
                                        {reasoning_content}
                                    </ReactMarkdown>
                                </div>
                            </CollapsibleContent>
                        </Collapsible>
                    )}

                    <div className="w-full min-w-0">
                        <div className={cn(
                            "prose prose-sm dark:prose-invert max-w-none break-words relative leading-relaxed",
                            "[&_pre]:m-0 [&_pre]:p-0 [&_pre]:bg-transparent",
                            isTyping && displayContent && "typing-active"
                        )}>
                            <ReactMarkdown components={{
                                pre: ({ children }) => <>{children}</>,
                                code: ({ node, inline, className, children, ...props }: any) => {
                                    const match = /language-(\w+)/.exec(className || '')
                                    const codeString = String(children).replace(/\n$/, '')

                                    if (!inline && match) {
                                        return <CodeBlock language={match[1]} value={codeString} />
                                    }

                                    // Check if it's a code block without language (multi-line)
                                    if (!inline && codeString.includes('\n')) {
                                        return <CodeBlock language="text" value={codeString} />
                                    }

                                    return <InlineCode {...props}>{children}</InlineCode>
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
            </div>

            {/* Message Actions - Always at bottom border */}
            <div className="absolute bottom-0 left-[4.5rem] translate-y-1/2 flex items-center gap-1.5 z-10">
                {/* Copy button - always visible on mobile, hover on desktop */}
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground bg-background border border-border/50 shadow-sm rounded-md hover:bg-muted/50 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity duration-150"
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
                                    : "text-muted-foreground hover:text-foreground bg-background hover:bg-muted/50 sm:opacity-0 sm:group-hover:opacity-100"
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
                                    : "text-muted-foreground hover:text-foreground bg-background hover:bg-muted/50 sm:opacity-0 sm:group-hover:opacity-100"
                            )}
                            onClick={() => handleRate("down")}
                            disabled={isRating}
                            title="Bad response"
                        >
                            <ThumbsDown className={cn("h-3.5 w-3.5", rating === "down" && "fill-current")} />
                        </Button>
                    </>
                )}

                {/* Retry button - only for last assistant message when not loading */}
                {role === "assistant" && isLastAssistant && onRetry && !isLoading && generation_id && (
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground bg-background border border-border/50 shadow-sm rounded-md hover:bg-muted/50 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity duration-150"
                        onClick={onRetry}
                        title="Regenerate response"
                    >
                        <RotateCcw className="h-3.5 w-3.5" />
                    </Button>
                )}

                {/* Sibling navigation - show when multiple responses exist */}
                {role === "assistant" && hasSiblings && onNavigateSibling && (
                    <div className="flex items-center gap-0.5 bg-background border border-border/50 shadow-sm rounded-md sm:opacity-0 sm:group-hover:opacity-100 transition-opacity duration-150">
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-l-md rounded-r-none"
                            onClick={() => onNavigateSibling('prev')}
                            disabled={(siblingIndex ?? 0) === 0}
                            title="Previous response"
                        >
                            <ChevronLeft className="h-3.5 w-3.5" />
                        </Button>
                        <span className="text-xs text-muted-foreground px-1 tabular-nums select-none">
                            {(siblingIndex ?? 0) + 1}/{siblingCount}
                        </span>
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-r-md rounded-l-none"
                            onClick={() => onNavigateSibling('next')}
                            disabled={(siblingIndex ?? 0) >= (siblingCount ?? 1) - 1}
                            title="Next response"
                        >
                            <ChevronRight className="h-3.5 w-3.5" />
                        </Button>
                    </div>
                )}

                {/* View generation details - only show on hover */}
                {generation_id && onViewGeneration && (
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground bg-background border border-border/50 shadow-sm rounded-md hover:bg-muted/50 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity duration-150"
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
