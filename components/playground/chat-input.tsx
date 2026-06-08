"use client"

import * as React from "react"
import { ArrowUp, FileText, Paperclip, X } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { useDeviceSettingsStore } from "@/lib/stores/device-settings-store"
import { ConnectedModelSelector } from "@/components/playground/model-selector"
import { ModelChipsWithConfig } from "@/components/playground/model-chips-with-config"
import type { ContentPart, MessageContent } from "@/lib/schemas/content"
import { cn } from "@/lib/utils"

export interface ChatInputConfig {
    historyLimit: number
    systemPrompt: string
    singleModelMode: boolean
}

export interface ChatInputCallbacks {
    onHistoryLimitChange: (value: number) => void
    onSystemPromptChange: (value: string) => void
    onSingleModelModeChange: (value: boolean) => void
}

interface ChatInputProps {
    conversationId: string
    /** Receives multimodal content — plain string for text-only turns,
     *  ContentPart[] when attachments are present. */
    onSubmit: (content: MessageContent) => void
    isLoading: boolean
    onStop: () => void
    configRef: React.RefObject<ChatInputConfig>
    callbacksRef: React.RefObject<ChatInputCallbacks>
}

export interface ChatInputRef {
    focus: () => void
    clear: () => void
}

// ---- Attachment model ----

interface Attachment {
    /** Local key — not persisted, regenerated each session. */
    id: string
    filename: string
    mime: string
    size: number
    /** `data:<mime>;base64,…` URL. */
    dataUrl: string
    /** Image previews vs file chips. */
    kind: "image" | "file"
}

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024 // 10 MB per file
const ACCEPTED_MIME_PREFIXES = ["image/", "application/pdf", "text/"]

function fileKind(mime: string): "image" | "file" {
    return mime.startsWith("image/") ? "image" : "file"
}

function isAcceptedMime(mime: string): boolean {
    return ACCEPTED_MIME_PREFIXES.some((p) => mime.startsWith(p))
}

function readAsDataURL(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result ?? ""))
        reader.onerror = () => reject(reader.error ?? new Error("Read failed"))
        reader.readAsDataURL(file)
    })
}

function humanSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function attachmentToPart(a: Attachment): ContentPart {
    if (a.kind === "image") {
        return { type: "image_url", image_url: { url: a.dataUrl } }
    }
    return {
        type: "file",
        file: { filename: a.filename, file_data: a.dataUrl, mime_type: a.mime },
    }
}

// ---- Component ----

export const ChatInput = React.memo(React.forwardRef<ChatInputRef, ChatInputProps>(function ChatInput({
    conversationId,
    onSubmit,
    isLoading,
    onStop,
    configRef,
    callbacksRef,
}, ref) {
    const [text, setText] = React.useState("")
    const [attachments, setAttachments] = React.useState<Attachment[]>([])
    const [isDragging, setIsDragging] = React.useState(false)
    const textareaRef = React.useRef<HTMLTextAreaElement>(null)
    const fileInputRef = React.useRef<HTMLInputElement>(null)
    const dragCounterRef = React.useRef(0)
    const isComposingRef = React.useRef(false)

    const sendOnEnter = useDeviceSettingsStore((s) => s.sendOnEnter)
    const sendOnEnterRef = React.useRef(sendOnEnter)
    sendOnEnterRef.current = sendOnEnter

    const onSubmitRef = React.useRef(onSubmit)
    onSubmitRef.current = onSubmit
    const onStopRef = React.useRef(onStop)
    onStopRef.current = onStop

    React.useImperativeHandle(ref, () => ({
        focus: () => textareaRef.current?.focus(),
        clear: () => {
            setText("")
            setAttachments([])
        },
    }), [])

    // ---- auto-grow textarea ----

    const adjustHeight = React.useCallback(() => {
        const ta = textareaRef.current
        if (!ta) return
        ta.style.height = "auto"
        const next = Math.min(ta.scrollHeight, 240) // ~12 visual lines max
        ta.style.height = `${next}px`
    }, [])

    React.useEffect(() => {
        adjustHeight()
    }, [text, attachments.length, adjustHeight])

    // ---- attachment ingestion ----

    const ingestFiles = React.useCallback(async (files: File[]) => {
        if (files.length === 0) return
        const accepted: Attachment[] = []
        for (const f of files) {
            if (f.size > MAX_ATTACHMENT_BYTES) {
                toast.error(`${f.name}: exceeds ${humanSize(MAX_ATTACHMENT_BYTES)}`)
                continue
            }
            const mime = f.type || "application/octet-stream"
            if (!isAcceptedMime(mime)) {
                toast.error(`${f.name}: unsupported type ${mime}`)
                continue
            }
            try {
                const dataUrl = await readAsDataURL(f)
                accepted.push({
                    id: crypto.randomUUID(),
                    filename: f.name || "attachment",
                    mime,
                    size: f.size,
                    dataUrl,
                    kind: fileKind(mime),
                })
            } catch {
                toast.error(`${f.name}: failed to read`)
            }
        }
        if (accepted.length > 0) {
            setAttachments((prev) => [...prev, ...accepted])
        }
    }, [])

    const removeAttachment = React.useCallback((id: string) => {
        setAttachments((prev) => prev.filter((a) => a.id !== id))
    }, [])

    // ---- submit ----

    const buildContent = React.useCallback((): MessageContent | null => {
        const t = text.trim()
        if (attachments.length === 0) {
            return t || null
        }
        const parts: ContentPart[] = []
        if (t) parts.push({ type: "text", text: t })
        for (const a of attachments) parts.push(attachmentToPart(a))
        return parts.length > 0 ? parts : null
    }, [text, attachments])

    const handleSubmit = React.useCallback((e?: React.FormEvent) => {
        e?.preventDefault()
        if (isLoading) return
        const content = buildContent()
        if (!content) return
        onSubmitRef.current(content)
        setText("")
        setAttachments([])
    }, [buildContent, isLoading])

    // ---- events ----

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

    const handlePaste = React.useCallback(async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
        const items = e.clipboardData?.items
        if (!items || items.length === 0) return
        const files: File[] = []
        for (const item of items) {
            if (item.kind === "file") {
                const f = item.getAsFile()
                if (f) files.push(f)
            }
        }
        if (files.length > 0) {
            e.preventDefault()
            await ingestFiles(files)
        }
    }, [ingestFiles])

    const handleDragEnter = React.useCallback((e: React.DragEvent) => {
        if (!e.dataTransfer?.types?.includes("Files")) return
        e.preventDefault()
        dragCounterRef.current += 1
        setIsDragging(true)
    }, [])

    const handleDragOver = React.useCallback((e: React.DragEvent) => {
        if (!e.dataTransfer?.types?.includes("Files")) return
        e.preventDefault()
        e.dataTransfer.dropEffect = "copy"
    }, [])

    const handleDragLeave = React.useCallback(() => {
        dragCounterRef.current = Math.max(0, dragCounterRef.current - 1)
        if (dragCounterRef.current === 0) setIsDragging(false)
    }, [])

    const handleDrop = React.useCallback(async (e: React.DragEvent) => {
        e.preventDefault()
        dragCounterRef.current = 0
        setIsDragging(false)
        const files = Array.from(e.dataTransfer?.files ?? [])
        if (files.length > 0) await ingestFiles(files)
    }, [ingestFiles])

    const handleFilePicker = React.useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files ?? [])
        e.target.value = "" // allow picking the same file again
        if (files.length > 0) await ingestFiles(files)
    }, [ingestFiles])

    const canSubmit = !isLoading && (text.trim().length > 0 || attachments.length > 0)

    return (
        <form
            onSubmit={handleSubmit}
            className="flex flex-col gap-2 w-full mx-auto max-w-4xl relative"
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
        >
            <div className="flex items-center gap-2 px-2">
                <ConnectedModelSelector conversationId={conversationId} />
                <ModelChipsWithConfig
                    conversationId={conversationId}
                    historyLimit={configRef.current?.historyLimit ?? 20}
                    systemPrompt={configRef.current?.systemPrompt ?? ""}
                    singleModelMode={configRef.current?.singleModelMode ?? false}
                    onHistoryLimitChange={callbacksRef.current?.onHistoryLimitChange ?? (() => { })}
                    onSystemPromptChange={callbacksRef.current?.onSystemPromptChange ?? (() => { })}
                    onSingleModelModeChange={callbacksRef.current?.onSingleModelModeChange ?? (() => { })}
                />
            </div>

            <div
                className={cn(
                    "flex flex-col gap-2 bg-background border rounded-2xl px-2 py-2 focus-within:ring-1 focus-within:ring-ring shadow-lg transition-colors",
                    isDragging && "border-primary ring-2 ring-primary/40 bg-primary/5",
                )}
            >
                {attachments.length > 0 && (
                    <div className="flex flex-wrap gap-2 px-1 pt-1">
                        {attachments.map((a) => (
                            <AttachmentChip
                                key={a.id}
                                attachment={a}
                                onRemove={() => removeAttachment(a.id)}
                            />
                        ))}
                    </div>
                )}

                <div className="flex items-end gap-2">
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="rounded-full h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                        title="Attach files (images / PDFs / text)"
                        onClick={() => fileInputRef.current?.click()}
                    >
                        <Paperclip className="h-5 w-5" />
                    </Button>
                    <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        accept="image/*,application/pdf,text/*"
                        className="hidden"
                        onChange={handleFilePicker}
                    />

                    <textarea
                        ref={textareaRef}
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        placeholder={isDragging ? "Drop files to attach" : "Message AI… (paste / drag-drop files)"}
                        className="min-h-[32px] max-h-[240px] border-0 focus-visible:outline-none resize-none p-0 py-[6px] bg-transparent flex-1 text-sm leading-[20px]"
                        onKeyDown={handleKeyDown}
                        onPaste={handlePaste}
                        onCompositionStart={() => { isComposingRef.current = true }}
                        onCompositionEnd={() => { isComposingRef.current = false }}
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
                        ) : canSubmit && (
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
            </div>
        </form>
    )
}), (prev, next) => (
    prev.conversationId === next.conversationId &&
    prev.isLoading === next.isLoading
))

// ---- attachment chip ----

function AttachmentChip({ attachment, onRemove }: { attachment: Attachment; onRemove: () => void }) {
    const isImage = attachment.kind === "image"
    return (
        <div className="group relative inline-flex items-center gap-2 rounded-lg border bg-muted/40 pl-2 pr-1 py-1 text-xs max-w-[240px]">
            {isImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                    src={attachment.dataUrl}
                    alt={attachment.filename}
                    className="h-8 w-8 rounded object-cover shrink-0"
                />
            ) : (
                <span className="flex h-8 w-8 items-center justify-center rounded bg-muted shrink-0">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                </span>
            )}
            <div className="min-w-0 flex-1">
                <div className="truncate text-foreground" title={attachment.filename}>
                    {attachment.filename}
                </div>
                <div className="text-[10px] text-muted-foreground font-mono">
                    {humanSize(attachment.size)}
                </div>
            </div>
            <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                onClick={onRemove}
                title="Remove"
            >
                <X className="h-3.5 w-3.5" />
            </Button>
        </div>
    )
}
