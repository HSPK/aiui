"use client"

import { messages } from "@/lib/api/conversations";
import * as React from "react"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Check, Copy, ChevronDown, ChevronRight, ThumbsUp, ThumbsDown, Info, RotateCcw, AlertCircle } from "lucide-react"
import { cn, formatMessageTime } from "@/lib/utils"
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { ProviderIcon } from "@/components/ProviderIcon"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { preferences } from "@/lib/api/preferences"
import { defaultUserPreferences } from "@/lib/schemas/preferences"
import { extractText, type ContentPart } from "@/lib/schemas/content"
import type { Message, AssembledToolCall } from "@/components/playground/chat/types"
import { useTypewriter } from "@/components/playground/chat/use-typewriter"
import { ToolCallsList } from "@/components/playground/tool-calls-list"
import { markdownComponents } from "./_parts/chat-markdown"
import { AttachmentsView } from "./_parts/attachments"

import { toast } from "sonner"

// Module-level stable arrays for ReactMarkdown plugins. Without
// these, `remarkPlugins={[...]}` and `rehypePlugins={[...]}` would
// allocate fresh arrays on every render, and react-markdown would
// rebuild its unified processor (re-parse the whole document) on
// each stream delta. The plugins themselves never change at
// runtime, so freeze them once.
const REMARK_PLUGINS = [remarkMath, remarkGfm] as const
const REHYPE_PLUGINS = [rehypeKatex] as const

interface ChatMessageProps {
    message: Message
    provider?: string
    isTyping?: boolean
    onViewGeneration?: (generationId: string) => void
    // Retry/regenerate support
    isLastAssistant?: boolean
    /** Generate an alternative sibling for the last successful
     *  assistant message. Distinct from `onRetryFailed`, which only
     *  re-runs failed slots. */
    onRegenerate?: () => void
    /** Per-message retry for failed assistant slots — wired to the
     *  retry button on the inline error card. */
    onRetryFailed?: (failedAssistantId: string) => void
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
    onRegenerate,
    onRetryFailed,
    isLoading,
    isSibling,
    siblingCount,
    isSelected,
    onSelect
}: ChatMessageProps) => {
    const { role, content, reasoning_content, model_id, created_at, generation_id, rating: initialRating, error: messageError } = message
    const messageDate = created_at
    const [copied, setCopied] = React.useState(false)
    // Tracks the 2s "Copied!" → "Copy" timer so we can clear it on
    // unmount and avoid a setState-after-unmount no-op when the user
    // navigates away mid-toast.
    const copyTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
    React.useEffect(() => () => {
        if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    }, [])
    const [isReasoningOpen, setIsReasoningOpen] = React.useState(true)
    const [rating, setRating] = React.useState<"up" | "down" | "none">(
        (initialRating as "up" | "down" | "none") || "none"
    )
    const [isRating, setIsRating] = React.useState(false)
    // Mobile-only: per-message actions toolbar visibility. Desktop
    // uses hover (no state needed). Tap the bubble body to toggle.
    const [showActionsMobile, setShowActionsMobile] = React.useState(false)
    const { data: userPrefsServer } = preferences.useGet()
    const userPrefs = userPrefsServer ?? defaultUserPreferences
    const userName = userPrefs.user_name?.trim() || "User"
    const userAvatar = userPrefs.user_avatar || "👤"
    const bubbleStyle = userPrefs.chat_bubble_style
    const renderMode = userPrefs.chat_render_mode
    const typewriterCps = userPrefs.typewriter_cps

    // Sync rating state when initialRating changes (e.g., from server)
    React.useEffect(() => {
        if (initialRating) {
            setRating(initialRating as "up" | "down" | "none")
        }
    }, [initialRating])

    // Content can be a plain string OR a multimodal ContentPart[]. Split
    // into the text view (markdown + typewriter operate on text) and the
    // attachment parts rendered separately above the text.
    const displayContent = extractText(content ?? "")
    const attachmentParts = React.useMemo<ContentPart[]>(() => {
        if (!Array.isArray(content)) return []
        return content.filter((p) => p.type === "image_url" || p.type === "file") as ContentPart[]
    }, [content])

    // Persisted tool_call parts (from a server-fetched message) are
    // hoisted into the same `tool_calls` array the live updater uses,
    // so the renderer doesn't need a second code path.
    const renderedToolCalls = React.useMemo<AssembledToolCall[]>(() => {
        if (message.tool_calls && message.tool_calls.length > 0) {
            return message.tool_calls
        }
        if (!Array.isArray(content)) return []
        const calls: AssembledToolCall[] = []
        for (const p of content) {
            if (p.type === "tool_call") {
                calls.push({
                    id: p.tool_call.id,
                    name: p.tool_call.name,
                    arguments: p.tool_call.arguments,
                    source: p.tool_call.source,
                })
            }
        }
        return calls
    }, [content, message.tool_calls])

    const typewriterEnabled = renderMode === "typewriter" && role === "assistant"
    const animatedContent = useTypewriter(displayContent, {
        enabled: typewriterEnabled,
        cps: typewriterCps,
    })
    const visibleContent = typewriterEnabled ? animatedContent : displayContent
    const typewriterAnimating = typewriterEnabled && animatedContent.length < displayContent.length
    const showCursor = role === "assistant"
        && renderMode !== "instant"
        && (isTyping || typewriterAnimating)

    const onCopy = React.useCallback(() => {
        navigator.clipboard.writeText(displayContent)
        if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
        setCopied(true)
        copyTimerRef.current = setTimeout(() => setCopied(false), 2000)
    }, [displayContent])

    const handleRate = React.useCallback(async (newRating: "up" | "down") => {
        if (!message.id || isRating) return

        const targetRating = rating === newRating ? "none" : newRating
        setIsRating(true)

        try {
            await messages.rate(message.id, targetRating)
            setRating(targetRating)
        } catch {
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

    // Layout knobs derived from chat_bubble_style. Siblings keep the existing
    // card treatment regardless — they're a separate UX surface.
    const isPlain = isSibling || bubbleStyle === "plain"
    const isBubble = !isSibling && bubbleStyle === "bubble"
    const isMinimal = !isSibling && bubbleStyle === "minimal"
    const showHeader = isPlain
    const isUserBubble = isBubble && role === "user"

    // Mobile tap-to-toggle handler — ignore taps that originated from
    // interactive elements (links, buttons, code blocks with own copy
    // affordance, native-text-selection long-press doesn't fire onClick).
    const handleBubbleTap = React.useCallback(
        (e: React.MouseEvent) => {
            // Sibling-pick uses onSelect; preserve that contract.
            if (onSelect) {
                onSelect()
                if (isSibling) return
            }
            const target = e.target as HTMLElement
            if (target.closest("a, button, input, select, textarea, pre, code, [role=button], summary")) {
                return
            }
            setShowActionsMobile((v) => !v)
        },
        [onSelect, isSibling],
    )

    // Container opacity contract:
    //   - Mobile: hidden by default; visible when user taps the bubble
    //     OR when there's a sticky rating (so a rated message keeps
    //     showing its filled thumb).
    //   - Desktop: hover-driven via `group-hover`; sticky rating forces
    //     always-visible there too.
    const hasStickyAction = rating === "up" || rating === "down"
    const actionsVisible = showActionsMobile || hasStickyAction

    return (
        <div
            onClick={handleBubbleTap}
            className={cn(
                "group relative transition-all m-0.5",
                !isSibling && "flex w-full",
                !isSibling && isPlain && "gap-3 sm:gap-4 px-4 sm:px-6 md:px-6 lg:px-6 py-4 sm:py-6 hover:bg-muted/30",
                !isSibling && isBubble && "px-4 sm:px-6 py-3 sm:py-4",
                !isSibling && isMinimal && "px-4 sm:px-6 py-2 sm:py-2.5 hover:bg-muted/20",
                isSibling && "flex flex-col gap-3 border rounded-xl shadow-sm bg-card flex-shrink-0 px-4 py-4",
                isSibling && siblingWidthClass,
                isSibling && isSelected && "ring-0 ring-primary/20 border-primary/30 bg-card",
                isSibling && !isSelected && "border-border/50 bg-muted/30 hover:bg-card hover:shadow-md",
                isSibling && onSelect && "cursor-pointer",
                isSibling && !onSelect && "cursor-default"
            )}
        >
            <div
                className={cn(
                    "flex flex-col w-full min-w-0",
                    isPlain && "gap-3",
                    isBubble && (isUserBubble ? "items-end gap-1.5" : "items-start gap-1.5"),
                    isMinimal && "gap-1"
                )}
            >
                {showHeader && (
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
                )}

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
                                    remarkPlugins={REMARK_PLUGINS as never}
                                    rehypePlugins={REHYPE_PLUGINS as never}
                                    components={markdownComponents}
                                >
                                    {reasoning_content}
                                </ReactMarkdown>
                            </div>
                        </CollapsibleContent>
                    </Collapsible>
                )}

                <div
                    className={cn(
                        "min-w-0",
                        isPlain && "w-full",
                        isBubble && "max-w-[85%] sm:max-w-[75%]",
                        isMinimal && "w-full"
                    )}
                >
                    {messageError ? (
                        <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
                            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-destructive" />
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-destructive">
                                    Generation failed
                                </p>
                                <p className="text-xs text-muted-foreground mt-1 break-words">
                                    {messageError}
                                </p>
                            </div>
                            {onRetryFailed && !isLoading && (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 shrink-0 text-xs"
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        onRetryFailed(message.id)
                                    }}
                                >
                                    <RotateCcw className="h-3 w-3 mr-1" />
                                    Retry
                                </Button>
                            )}
                        </div>
                    ) : (
                        <div className={cn(
                            "prose prose-sm dark:prose-invert max-w-none break-words relative leading-relaxed",
                            "[&_pre]:m-0 [&_pre]:p-0 [&_pre]:bg-transparent",
                            isBubble && "rounded-2xl px-4 py-2.5",
                            isBubble && !isUserBubble && "bg-muted/50",
                            isUserBubble && "bg-primary text-primary-foreground [&_strong]:text-primary-foreground [&_a]:text-primary-foreground [&_a]:underline",
                            showCursor && visibleContent && "typing-active"
                        )}>
                            {attachmentParts.length > 0 && (
                                <AttachmentsView parts={attachmentParts} />
                            )}
                            <ReactMarkdown
                                remarkPlugins={REMARK_PLUGINS as never}
                                rehypePlugins={REHYPE_PLUGINS as never}
                                components={markdownComponents}
                            >
                                {visibleContent}
                            </ReactMarkdown>
                            {renderedToolCalls.length > 0 && (
                                <ToolCallsList calls={renderedToolCalls} />
                            )}
                            {showCursor && !visibleContent && (
                                <span className="typing-cursor text-primary">▋</span>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Message Actions. Mobile: hidden by default, tap the
                bubble to reveal (long-press text still triggers native
                copy/select). Desktop: hover reveals via `group-hover`.
                Sticky rated state overrides — the rating thumb keeps
                showing so users can tell at a glance what they voted. */}
            <div
                className={cn(
                    "absolute bottom-0 translate-y-1/2 flex items-center gap-1.5 z-10 transition-opacity duration-150",
                    isSibling && "left-4",
                    !isSibling && isPlain && "left-[4.5rem]",
                    !isSibling && isMinimal && "left-4",
                    !isSibling && isBubble && !isUserBubble && "left-4",
                    !isSibling && isUserBubble && "right-4",
                    actionsVisible
                        ? "opacity-100 pointer-events-auto"
                        : "opacity-0 pointer-events-none sm:pointer-events-auto sm:group-hover:opacity-100",
                )}
                onClick={(e) => e.stopPropagation()}
            >
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground bg-background border border-border/50 shadow-sm rounded-md hover:bg-muted/50"
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
                                "h-6 w-6 p-0 rounded-md border border-border/50 shadow-sm",
                                rating === "up"
                                    ? "text-green-500 bg-green-500/10 hover:bg-green-500/20 border-green-500/30"
                                    : "text-muted-foreground hover:text-foreground bg-background hover:bg-muted/50"
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
                                "h-6 w-6 p-0 rounded-md border border-border/50 shadow-sm",
                                rating === "down"
                                    ? "text-red-500 bg-red-500/10 hover:bg-red-500/20 border-red-500/30"
                                    : "text-muted-foreground hover:text-foreground bg-background hover:bg-muted/50"
                            )}
                            onClick={() => handleRate("down")}
                            disabled={isRating}
                            title="Bad response"
                        >
                            <ThumbsDown className={cn("h-3.5 w-3.5", rating === "down" && "fill-current")} />
                        </Button>
                    </>
                )}

                {/* Regenerate button - last successful assistant message only */}
                {role === "assistant" && isLastAssistant && onRegenerate && !isLoading && generation_id && (
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground bg-background border border-border/50 shadow-sm rounded-md hover:bg-muted/50"
                        onClick={(e) => {
                            e.stopPropagation()
                            onRegenerate()
                        }}
                        title="Regenerate response"
                    >
                        <RotateCcw className="h-3.5 w-3.5" />
                    </Button>
                )}

                {/* View generation details */}
                {generation_id && onViewGeneration && (
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground bg-background border border-border/50 shadow-sm rounded-md hover:bg-muted/50"
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

// =============================================================================
// AttachmentsView — renders image_url and file parts that came with a
// user message. Read-only (no remove); for editing flow back to the
// chat input.
// AttachmentsView, ImageAttachment, FileAttachment — see _parts/attachments.tsx
// Tool call rendering — see tool-calls-list.tsx
