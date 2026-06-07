"use client"

import * as React from "react"
import { Plus, ArrowUp } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useDeviceSettingsStore } from "@/lib/stores/device-settings-store"
import { ConnectedModelSelector } from "@/components/playground/model-selector"
import { ModelChipsWithConfig } from "@/components/playground/model-chips-with-config"

export interface ChatInputConfig {
    historyLimit: number
}

export interface ChatInputCallbacks {
    onHistoryLimitChange: (value: number) => void
}

interface ChatInputProps {
    conversationId: string
    onSubmit: (input: string) => void
    isLoading: boolean
    onStop: () => void
    configRef: React.RefObject<ChatInputConfig>
    callbacksRef: React.RefObject<ChatInputCallbacks>
}

export interface ChatInputRef {
    focus: () => void
    clear: () => void
    getValue: () => string
}

export const ChatInput = React.memo(React.forwardRef<ChatInputRef, ChatInputProps>(function ChatInput({
    conversationId,
    onSubmit,
    isLoading,
    onStop,
    configRef,
    callbacksRef,
}, ref) {
    const inputRef = React.useRef("")
    const [hasInput, setHasInput] = React.useState(false)
    const textareaRef = React.useRef<HTMLTextAreaElement>(null)

    // IME composition guard (Chinese / Japanese / Korean).
    const isComposingRef = React.useRef(false)

    const sendOnEnter = useDeviceSettingsStore((s) => s.sendOnEnter)
    const sendOnEnterRef = React.useRef(sendOnEnter)
    sendOnEnterRef.current = sendOnEnter

    const onSubmitRef = React.useRef(onSubmit)
    const onStopRef = React.useRef(onStop)
    onSubmitRef.current = onSubmit
    onStopRef.current = onStop

    React.useImperativeHandle(ref, () => ({
        focus: () => textareaRef.current?.focus(),
        clear: () => {
            inputRef.current = ""
            if (textareaRef.current) textareaRef.current.value = ""
            setHasInput(false)
        },
        getValue: () => inputRef.current,
    }), [])

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

    const handleInputChange = React.useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const value = e.target.value
        inputRef.current = value
        const newHasInput = value.trim().length > 0
        setHasInput((prev) => (prev !== newHasInput ? newHasInput : prev))
    }, [])

    const handleKeyDown = React.useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key !== "Enter") return
        const composing =
            isComposingRef.current ||
            e.nativeEvent.isComposing ||
            (e.nativeEvent as KeyboardEvent & { keyCode?: number }).keyCode === 229
        if (composing) return

        const cmdEnter = e.metaKey || e.ctrlKey
        if (sendOnEnterRef.current) {
            if (!e.shiftKey) {
                e.preventDefault()
                handleSubmit()
            }
        } else if (cmdEnter) {
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

    const showSubmit = !isLoading && hasInput

    return (
        <form onSubmit={handleSubmit} className="flex flex-col gap-2 w-full mx-auto max-w-4xl relative">
            <div className="flex items-center gap-2 px-2">
                <ConnectedModelSelector conversationId={conversationId} />
                <ModelChipsWithConfig
                    conversationId={conversationId}
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
    return (
        prevProps.conversationId === nextProps.conversationId &&
        prevProps.isLoading === nextProps.isLoading
    )
})
