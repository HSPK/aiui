"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Plus, ArrowUp } from "lucide-react"
import { ConnectedModelSelector } from "@/components/playground/model-selector"
import { ModelChipsWithConfig } from "@/components/playground/model-chips-with-config"
import { useDeviceSettingsStore } from "@/lib/stores/device-settings-store"

export interface ChatInputConfig {
    historyLimit: number
}

export interface ChatInputCallbacks {
    onHistoryLimitChange: (value: number) => void
}

interface ChatInputProps {
    tabId: string
    onSubmit: (input: string) => void
    isLoading: boolean
    onStop: () => void
    // Config passed via ref to prevent re-renders
    configRef: React.RefObject<ChatInputConfig>
    callbacksRef: React.RefObject<ChatInputCallbacks>
}

export interface ChatInputRef {
    focus: () => void
    clear: () => void
    getValue: () => string
}

export const ChatInput = React.memo(React.forwardRef<ChatInputRef, ChatInputProps>(function ChatInput({
    tabId,
    onSubmit,
    isLoading,
    onStop,
    configRef,
    callbacksRef,
}, ref) {
    // Use ref for input value - avoid React re-renders on every keystroke
    const inputRef = React.useRef("")
    const [hasInput, setHasInput] = React.useState(false) // Only track if has content for button
    const textareaRef = React.useRef<HTMLTextAreaElement>(null)

    // Track IME composition state (for Chinese/Japanese/Korean input methods).
    // We belt-and-braces this: many browsers fire `onKeyDown` BEFORE
    // `onCompositionEnd` when Enter commits a composition, so we also check
    // `e.nativeEvent.isComposing` and the legacy `keyCode === 229` sentinel.
    const isComposingRef = React.useRef(false)

    // sendOnEnter device preference — when false, Enter inserts a newline
    // and Cmd/Ctrl+Enter submits instead.
    const sendOnEnter = useDeviceSettingsStore((s) => s.sendOnEnter)
    const sendOnEnterRef = React.useRef(sendOnEnter)
    sendOnEnterRef.current = sendOnEnter

    // Use ref for callbacks to prevent recreation
    const onSubmitRef = React.useRef(onSubmit)
    const onStopRef = React.useRef(onStop)
    onSubmitRef.current = onSubmit
    onStopRef.current = onStop

    // Expose methods to parent
    React.useImperativeHandle(ref, () => ({
        focus: () => textareaRef.current?.focus(),
        clear: () => {
            inputRef.current = ""
            if (textareaRef.current) textareaRef.current.value = ""
            setHasInput(false)
        },
        getValue: () => inputRef.current,
    }), [])

    // Stable submit handler - NEVER changes
    const handleSubmit = React.useCallback((e?: React.FormEvent) => {
        e?.preventDefault()
        const value = inputRef.current.trim()
        if (value) {
            onSubmitRef.current(value)
            inputRef.current = ""
            if (textareaRef.current) textareaRef.current.value = ""
            setHasInput(false)
        }
    }, [])

    // Handle input change - minimal state updates
    const handleInputChange = React.useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const value = e.target.value
        inputRef.current = value
        const newHasInput = value.trim().length > 0
        // Only update state if hasInput actually changed
        setHasInput(prev => prev !== newHasInput ? newHasInput : prev)
    }, [])

    const handleKeyDown = React.useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key !== "Enter") return

        // Ignore Enter while an IME composition is active — multiple
        // signals because different browsers fire events in different
        // orders during composition commit.
        const composing =
            isComposingRef.current ||
            e.nativeEvent.isComposing ||
            (e.nativeEvent as KeyboardEvent & { keyCode?: number }).keyCode === 229
        if (composing) return

        const cmdEnter = e.metaKey || e.ctrlKey

        if (sendOnEnterRef.current) {
            // Enter submits, Shift+Enter inserts newline (default).
            if (!e.shiftKey) {
                e.preventDefault()
                handleSubmit()
            }
        } else {
            // Enter inserts newline (default), Cmd/Ctrl+Enter submits.
            if (cmdEnter) {
                e.preventDefault()
                handleSubmit()
            }
        }
    }, [handleSubmit])

    const handleCompositionStart = React.useCallback(() => {
        isComposingRef.current = true
    }, [])

    const handleCompositionEnd = React.useCallback(() => {
        isComposingRef.current = false
    }, [])

    // Show submit button based on hasInput state (not full input value)
    const showSubmit = !isLoading && hasInput

    return (
        <form onSubmit={handleSubmit} className="flex flex-col gap-2 w-full mx-auto max-w-4xl relative">
            {/* Model chips row - shows above input when models selected */}
            <div className="flex items-center gap-2 px-2">
                <ConnectedModelSelector tabId={tabId} />
                <ModelChipsWithConfig
                    tabId={tabId}
                    historyLimit={configRef.current?.historyLimit ?? 20}
                    onHistoryLimitChange={callbacksRef.current?.onHistoryLimitChange ?? (() => { })}
                />
            </div>

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
                    defaultValue=""
                    onChange={handleInputChange}
                    placeholder="Message AI..."
                    className="min-h-[32px] max-h-[200px] border-0 focus-visible:outline-none resize-none p-0 py-[6px] bg-transparent flex-1 text-sm leading-[20px]"
                    onKeyDown={handleKeyDown}
                    onCompositionStart={handleCompositionStart}
                    onCompositionEnd={handleCompositionEnd}
                    rows={1}
                />
                <div className="flex items-center gap-1 shrink-0">
                    {isLoading ? (
                        <Button
                            type="button"
                            size="icon"
                            onClick={(e) => {
                                e.preventDefault()
                                onStopRef.current()
                            }}
                            className="h-8 w-8 rounded-full ml-1 bg-secondary text-secondary-foreground hover:bg-secondary/80"
                        >
                            <div className="h-2.5 w-2.5 bg-current rounded-[1px]" />
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
}), (prevProps, nextProps) => {
    // Custom comparison - only re-render when these specific props change
    return (
        prevProps.tabId === nextProps.tabId &&
        prevProps.isLoading === nextProps.isLoading
        // Refs are stable, no need to compare
        // onSubmit, onStop use refs internally, no need to compare
    )
})
