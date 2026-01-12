"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Eraser, Plus, ArrowUp, RotateCcw } from "lucide-react"
import { ConnectedModelSelector } from "@/components/playground/model-selector"
import { ChatConfigDropdown } from "@/components/playground/chat-config-dropdown"

interface ChatInputProps {
    tabId: string
    input: string
    onInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
    onSubmit: (e: React.FormEvent) => void
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

export const ChatInput = React.memo(function ChatInput({
    tabId,
    input,
    onInputChange,
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
}: ChatInputProps) {
    // Track IME composition state (for Chinese/Japanese/Korean input methods)
    const isComposingRef = React.useRef(false)

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        // Ignore Enter during IME composition (e.g., selecting Chinese characters)
        if (e.key === 'Enter' && !e.shiftKey && !isComposingRef.current) {
            e.preventDefault()
            onSubmit(e as any)
        }
    }

    const handleCompositionStart = () => {
        isComposingRef.current = true
    }

    const handleCompositionEnd = () => {
        isComposingRef.current = false
    }

    return (
        <form onSubmit={onSubmit} className="flex flex-col gap-2 w-full mx-auto max-w-4xl relative">
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
                    onChange={onInputChange}
                    placeholder="Message AI..."
                    className="min-h-[32px] max-h-[200px] border-0 focus-visible:ring-0 resize-none p-0 py-[6px] bg-transparent dark:bg-transparent shadow-none flex-1 text-sm leading-[20px]"
                    onKeyDown={handleKeyDown}
                    onCompositionStart={handleCompositionStart}
                    onCompositionEnd={handleCompositionEnd}
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
                    ) : (input?.trim() && (
                        <Button
                            type="submit"
                            size="icon"
                            className="h-8 w-8 rounded-full ml-1 bg-primary text-primary-foreground"
                        >
                            <ArrowUp className="h-5 w-5" />
                        </Button>
                    ))}
                </div>
            </div>
        </form>
    )
})
