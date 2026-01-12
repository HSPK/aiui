"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Eraser, Plus, ArrowUp, RotateCcw } from "lucide-react"
import { ConnectedModelSelector } from "@/components/playground/model-selector"
import { ChatConfigDropdown } from "@/components/playground/chat-config-dropdown"

interface ChatInputProps {
    tabId: string
    onSubmit: (input: string) => void
    onRetry?: () => void
    isLoading: boolean
    onStop: () => void
    onClearMessages: () => void
    hasMessages: boolean
    lastMessageIsUser?: boolean
    // Config props
    temperature?: number
    onTemperatureChange: (value: number | undefined) => void
    historyLimit: number
    onHistoryLimitChange: (value: number) => void
    reasoningEffort: string | null
    onReasoningEffortChange: (value: string | null) => void
}

export interface ChatInputRef {
    focus: () => void
    clear: () => void
    getValue: () => string
}

export const ChatInput = React.memo(React.forwardRef<ChatInputRef, ChatInputProps>(function ChatInput({
    tabId,
    onSubmit,
    onRetry,
    isLoading,
    onStop,
    onClearMessages,
    hasMessages,
    lastMessageIsUser,
    temperature,
    onTemperatureChange,
    historyLimit,
    onHistoryLimitChange,
    reasoningEffort,
    onReasoningEffortChange,
}, ref) {
    // Local input state - isolated from parent to prevent re-renders
    const [input, setInput] = React.useState("")
    const textareaRef = React.useRef<HTMLTextAreaElement>(null)
    
    // Track IME composition state (for Chinese/Japanese/Korean input methods)
    const isComposingRef = React.useRef(false)
    
    // Expose methods to parent
    React.useImperativeHandle(ref, () => ({
        focus: () => textareaRef.current?.focus(),
        clear: () => setInput(""),
        getValue: () => input,
    }), [input])

    const handleSubmit = React.useCallback((e?: React.FormEvent) => {
        e?.preventDefault()
        const value = input.trim()
        if (value) {
            onSubmit(value)
            setInput("")
        }
    }, [input, onSubmit])

    const handleKeyDown = React.useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        // Ignore Enter during IME composition (e.g., selecting Chinese characters)
        if (e.key === 'Enter' && !e.shiftKey && !isComposingRef.current) {
            e.preventDefault()
            handleSubmit()
        }
    }, [handleSubmit])

    const handleCompositionStart = React.useCallback(() => {
        isComposingRef.current = true
    }, [])

    const handleCompositionEnd = React.useCallback(() => {
        isComposingRef.current = false
    }, [])

    // Show submit button based on local input state
    const showSubmit = !isLoading && !lastMessageIsUser && input.trim().length > 0

    return (
        <form onSubmit={handleSubmit} className="flex flex-col gap-2 w-full mx-auto max-w-4xl relative">
            <div className="flex items-end gap-2 bg-background border rounded-2xl px-2 py-2 focus-within:ring-1 focus-within:ring-ring shadow-lg">
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="rounded-full h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                    title="Add attachment"
                >
                    <Plus className="h-5 w-5" />
                </Button>

                <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Message AI..."
                    className="min-h-[32px] max-h-[200px] border-0 focus-visible:outline-none resize-none p-0 py-[6px] bg-transparent flex-1 text-sm leading-[20px]"
                    onKeyDown={handleKeyDown}
                    onCompositionStart={handleCompositionStart}
                    onCompositionEnd={handleCompositionEnd}
                    rows={1}
                />

                <div className="flex items-center gap-1 shrink-0">
                    <ConnectedModelSelector tabId={tabId} />

                    <ChatConfigDropdown
                        temperature={temperature}
                        onTemperatureChange={onTemperatureChange}
                        historyLimit={historyLimit}
                        onHistoryLimitChange={onHistoryLimitChange}
                        reasoningEffort={reasoningEffort}
                        onReasoningEffortChange={onReasoningEffortChange}
                    />

                    {isLoading ? (
                        <Button
                            type="button"
                            size="icon"
                            onClick={(e) => {
                                e.preventDefault()
                                onStop()
                            }}
                            className="h-8 w-8 rounded-full ml-1 bg-secondary text-secondary-foreground hover:bg-secondary/80"
                        >
                            <div className="h-2.5 w-2.5 bg-current rounded-[1px]" />
                        </Button>
                    ) : lastMessageIsUser ? (
                        // Show retry button when last message is from user
                        <Button
                            type="button"
                            size="icon"
                            onClick={(e) => {
                                e.preventDefault()
                                onRetry?.()
                            }}
                            className="h-8 w-8 rounded-full ml-1 bg-orange-500 text-white hover:bg-orange-600"
                            title="Retry last message"
                        >
                            <RotateCcw className="h-4 w-4" />
                        </Button>
                    ) : showSubmit && (
                        <Button
                            type="submit"
                            size="icon"
                            className="h-8 w-8 rounded-full ml-1 bg-primary text-primary-foreground"
                        >
                            <ArrowUp className="h-5 w-5" />
                        </Button>
                    )}
                </div>
            </div>
        </form>
    )
}))
