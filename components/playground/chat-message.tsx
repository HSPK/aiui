"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Check, Copy, ChevronDown, ChevronRight, ChevronLeft, ThumbsUp, ThumbsDown, Info, RotateCcw } from "lucide-react"
import { cn, formatMessageTime } from "@/lib/utils"
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ProviderIcon } from "@/components/ProviderIcon"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { useSettingsStore } from "@/lib/stores/settings-store"
import { api } from "@/lib/api"
import { toast } from "sonner"
import { CodeBlock, InlineCode } from "./code-block"

// Markdown components with full GFM support (tables, lists, checkboxes, etc.)
const markdownComponents = {
    pre: ({ children }: any) => <>{children}</>,
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
    },
    // Table styling
    table: ({ children }: any) => (
        <div className="my-4 overflow-x-auto rounded-lg border border-border">
            <table className="w-full border-collapse text-sm">{children}</table>
        </div>
    ),
    thead: ({ children }: any) => (
        <thead className="bg-muted/50">{children}</thead>
    ),
    tbody: ({ children }: any) => (
        <tbody className="divide-y divide-border">{children}</tbody>
    ),
    tr: ({ children }: any) => (
        <tr className="border-b border-border last:border-0">{children}</tr>
    ),
    th: ({ children }: any) => (
        <th className="px-4 py-2 text-left font-semibold text-foreground border-r border-border last:border-r-0">{children}</th>
    ),
    td: ({ children }: any) => (
        <td className="px-4 py-2 text-muted-foreground border-r border-border last:border-r-0">{children}</td>
    ),
    // List styling
    ul: ({ children, className }: any) => {
        // Check if it's a task list (contains checkboxes)
        const isTaskList = className?.includes('contains-task-list')
        return (
            <ul className={cn(
                "my-2 ml-4",
                isTaskList ? "list-none space-y-1" : "list-disc space-y-1"
            )}>{children}</ul>
        )
    },
    ol: ({ children }: any) => (
        <ol className="my-2 ml-4 list-decimal space-y-1">{children}</ol>
    ),
    li: ({ children, className }: any) => {
        const isTaskItem = className?.includes('task-list-item')
        return (
            <li className={cn(
                "leading-relaxed",
                isTaskItem && "flex items-start gap-2 list-none"
            )}>{children}</li>
        )
    },
    // Task list checkbox
    input: ({ type, checked, ...props }: any) => {
        if (type === 'checkbox') {
            return (
                <input
                    type="checkbox"
                    checked={checked}
                    readOnly
                    className="mt-1 h-4 w-4 rounded border-border text-primary focus:ring-primary"
                    {...props}
                />
            )
        }
        return <input type={type} {...props} />
    },
    // Blockquote styling
    blockquote: ({ children }: any) => (
        <blockquote className="my-3 border-l-4 border-primary/30 pl-4 italic text-muted-foreground">{children}</blockquote>
    ),
    // Horizontal rule
    hr: () => <hr className="my-4 border-border" />,
    // Links
    a: ({ href, children }: any) => (
        <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2 hover:text-primary/80">{children}</a>
    ),
    // Strikethrough (GFM)
    del: ({ children }: any) => (
        <del className="text-muted-foreground line-through">{children}</del>
    ),
    // Strong/Bold
    strong: ({ children }: any) => (
        <strong className="font-semibold text-foreground">{children}</strong>
    ),
    // Emphasis/Italic
    em: ({ children }: any) => (
        <em className="italic">{children}</em>
    ),
    // Headings
    h1: ({ children }: any) => <h1 className="mt-6 mb-3 text-2xl font-bold">{children}</h1>,
    h2: ({ children }: any) => <h2 className="mt-5 mb-2 text-xl font-bold">{children}</h2>,
    h3: ({ children }: any) => <h3 className="mt-4 mb-2 text-lg font-semibold">{children}</h3>,
    h4: ({ children }: any) => <h4 className="mt-3 mb-1 text-base font-semibold">{children}</h4>,
    h5: ({ children }: any) => <h5 className="mt-2 mb-1 text-sm font-semibold">{children}</h5>,
    h6: ({ children }: any) => <h6 className="mt-2 mb-1 text-sm font-medium text-muted-foreground">{children}</h6>,
    // Paragraph
    p: ({ children }: any) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
}

interface ChatMessageProps {
    message: any
    provider?: string
    isTyping?: boolean
    onViewGeneration?: (generationId: string) => void
    // Retry/regenerate support
    isLastAssistant?: boolean
    onRetry?: () => void
    isLoading?: boolean
    // Sibling display
    isSibling?: boolean
    siblingCount?: number
    isSelected?: boolean
    onSelect?: () => void
}

export const ChatMessage = React.memo(({
    message,
    provider,
    isTyping,
    onViewGeneration,
    isLastAssistant,
    onRetry,
    isLoading,
    isSibling,
    siblingCount,
    isSelected,
    onSelect
}: ChatMessageProps) => {
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

    // Responsive width for sibling cards
    const siblingWidthClass = React.useMemo(() => {
        if (!isSibling) return ""
        // <640px: occupy ~90% viewport width. >=640px: enforce generous min width 576px (unless viewport smaller), allow moderate growth.
        return cn(
            "max-sm:w-[85vw]",
            "sm:min-w-[400px] sm:w-[600px] sm:max-w-[85vw]"
        )
    }, [isSibling])

    return (
        <div
            onClick={onSelect}
            className={cn(
                "group relative transition-all m-0.5",
                !isSibling && "flex gap-3 sm:gap-4 px-3 sm:px-4 w-full py-4 sm:py-6 hover:bg-muted/30",
                isSibling && "flex flex-col gap-3 border rounded-xl shadow-sm bg-card flex-shrink-0 px-4 py-4",
                isSibling && siblingWidthClass,
                isSibling && isSelected && "ring-0 ring-primary/20 border-primary/30 bg-card",
                isSibling && !isSelected && "border-border/50 bg-muted/30 hover:bg-card hover:shadow-md",
                isSibling && onSelect && "cursor-pointer",
                isSibling && !onSelect && "cursor-default"
            )}
        >
            <div className="flex flex-col gap-3 w-full">
                <div className="flex items-center gap-3 sm:gap-4 w-full">
                    <Avatar className="h-7 w-7 sm:h-8 sm:w-8 shrink-0 bg-background border shadow-sm">
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

                    <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm md:truncate md:whitespace-nowrap break-all">
                            {role === 'assistant' ? (provider ? `${provider} / ${model_id || 'Assistant'}` : (model_id || 'Assistant')) : userName}
                        </span>
                        <span suppressHydrationWarning className="text-[10px] text-muted-foreground tabular-nums select-none opacity-50 group-hover:opacity-100 transition-opacity">
                            {formatMessageTime(messageDate)}
                        </span>
                        {isSibling && isSelected && onSelect && (
                            <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium border border-primary/10">
                                Active
                            </span>
                        )}
                        {isSibling && isSelected && !onSelect && (
                            <span className="text-[10px] bg-muted text-muted-foreground px-2 py-0.5 rounded-full font-medium border">
                                Context
                            </span>
                        )}
                    </div>
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
                                    remarkPlugins={[remarkGfm]}
                                    components={markdownComponents}
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
                        <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={markdownComponents}
                        >
                            {displayContent}
                        </ReactMarkdown>
                        {isTyping && !displayContent && (
                            <span className="typing-cursor text-primary">▋</span>
                        )}
                    </div>
                </div>
            </div>

            {/* Message Actions - Always at bottom border */}
            <div className={cn(
                "absolute bottom-0 translate-y-1/2 flex items-center gap-1.5 z-10",
                isSibling ? "left-4" : "left-[4.5rem]"
            )}>
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
                        onClick={(e) => {
                            e.stopPropagation()
                            onRetry()
                        }}
                        title="Regenerate response"
                    >
                        <RotateCcw className="h-3.5 w-3.5" />
                    </Button>
                )}

                {/* View generation details - only show on hover */}
                {generation_id && onViewGeneration && (
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground bg-background border border-border/50 shadow-sm rounded-md hover:bg-muted/50 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity duration-150"
                        onClick={(e) => {
                            e.stopPropagation()
                            handleViewGeneration()
                        }}
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
