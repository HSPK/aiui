"use client"

import { useMemo, useState } from "react"
import {
    AlignLeft,
    ChevronDown,
    ChevronRight,
    Code,
    Paperclip,
    Wrench,
} from "lucide-react"
// @ts-ignore - react-markdown types
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import rehypeKatex from "rehype-katex"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { extractText, type ContentPart, type MessageContent } from "@/lib/schemas/content"
import { cn } from "@/lib/utils"

import { logMarkdownComponents } from "./markdown"
import { ContentViewer } from "./content-viewer"
import { CopyButton, sanitizeForJsonView } from "./json-tools"

// Stable plugin arrays — see chat-message.tsx for rationale.
const REMARK_PLUGINS = [remarkMath, remarkGfm] as const
const REHYPE_PLUGINS = [rehypeKatex] as const

/**
 * Chat-shaped prompt panel renderer. Walks the stored `messages[]`
 * array, rendering text + image previews + file chips per role, plus
 * the OpenAI `tool_calls` envelope and `role:"tool"` rows. Falls back
 * to <ContentViewer> when the log's input isn't chat-shaped
 * (embedding, audio, image generation, …).
 *
 * Future changes to how an upstream message renders (new content
 * parts, new tool-call shapes, citation tooltips, …) land in this
 * file. The outer <LogDetails> sheet doesn't need to know.
 */

interface ChatMessage {
    role?: string
    content?: MessageContent
    tool_call_id?: string
    tool_calls?: Array<{
        id?: string
        type?: string
        function?: { name?: string; arguments?: string }
    }>
}

/** Try to read a chat-completion-shaped messages array out of the log
 *  input. Returns null for non-chat shapes (embedding/image/etc.). */
function extractMessages(input: unknown): ChatMessage[] | null {
    if (!input || typeof input !== "object") return null
    const msgs = (input as { messages?: unknown }).messages
    if (!Array.isArray(msgs)) return null
    return msgs as ChatMessage[]
}

export function RequestPreview({
    title,
    input,
    fallback,
    colorClass,
}: {
    title: string
    input: unknown
    fallback: string | null
    colorClass: string
}) {
    const [viewMode, setViewMode] = useState<"preview" | "raw">("preview")
    const messages = useMemo(() => extractMessages(input), [input])
    const sanitizedRaw = useMemo(
        () => (messages ? JSON.stringify(sanitizeForJsonView(input), null, 2) : ""),
        [input, messages],
    )
    const copyText = useMemo(
        () => (messages
            ? messages.map((m) => `${m.role ?? "user"}: ${extractText(m.content ?? "")}`).join("\n\n")
            : ""),
        [messages],
    )

    if (!messages || messages.length === 0) {
        return <ContentViewer title={title} content={fallback} colorClass={colorClass} />
    }

    return (
        <div className="space-y-2 flex-1 min-w-[300px]">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold flex items-center gap-2">
                    <span className={cn("w-2 h-2 rounded-full", colorClass)} />
                    {title}
                </h3>
                <div className="flex items-center gap-2">
                    <div className="flex bg-muted rounded-md p-0.5 border">
                        <Button
                            variant="ghost"
                            size="sm"
                            className={cn("h-6 px-2 text-[10px] hover:bg-background/80", viewMode === "preview" && "bg-background shadow-sm")}
                            onClick={() => setViewMode("preview")}
                        >
                            <AlignLeft className="h-3 w-3 mr-1" /> Preview
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            className={cn("h-6 px-2 text-[10px] hover:bg-background/80", viewMode === "raw" && "bg-background shadow-sm")}
                            onClick={() => setViewMode("raw")}
                        >
                            <Code className="h-3 w-3 mr-1" /> Raw
                        </Button>
                    </div>
                    <CopyButton text={copyText} />
                </div>
            </div>

            <div className="border rounded-md overflow-hidden bg-muted/20">
                <div className="text-sm min-h-[100px] max-h-[500px] overflow-y-auto scrollbar-thin">
                    {viewMode === "preview" ? (
                        <div className="divide-y">
                            {messages.map((m, i) => (
                                <MessageRow key={i} message={m} />
                            ))}
                        </div>
                    ) : (
                        <pre className="p-3 text-xs font-mono whitespace-pre-wrap break-all text-muted-foreground">
                            {sanitizedRaw}
                        </pre>
                    )}
                </div>
            </div>
        </div>
    )
}

function MessageRow({ message }: { message: ChatMessage }) {
    const text = extractText(message.content ?? "")
    const parts = Array.isArray(message.content)
        ? (message.content.filter((p) => p.type === "image_url" || p.type === "file") as ContentPart[])
        : []
    const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : []
    const isToolRole = message.role === "tool"

    return (
        <div className="p-3 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className="text-[10px] uppercase tracking-wider font-semibold">
                    {message.role ?? "user"}
                </Badge>
                {parts.length > 0 && (
                    <span className="text-[10px] text-muted-foreground font-mono">
                        +{parts.length} attachment{parts.length === 1 ? "" : "s"}
                    </span>
                )}
                {toolCalls.length > 0 && (
                    <span className="text-[10px] text-muted-foreground font-mono">
                        +{toolCalls.length} tool call{toolCalls.length === 1 ? "" : "s"}
                    </span>
                )}
                {isToolRole && message.tool_call_id && (
                    <span className="text-[10px] text-muted-foreground font-mono truncate">
                        ↳ {message.tool_call_id}
                    </span>
                )}
            </div>
            {parts.length > 0 && (
                <div className="flex flex-wrap gap-2">
                    {parts.map((p, i) => {
                        if (p.type === "image_url") return <ImagePreview key={i} url={p.image_url.url} />
                        if (p.type === "file") return <FilePreview key={i} filename={p.file.filename} mime={p.file.mime_type} />
                        return null
                    })}
                </div>
            )}
            {text && !isToolRole && (
                <div className="prose prose-sm dark:prose-invert max-w-none break-words leading-relaxed">
                    <ReactMarkdown
                        remarkPlugins={REMARK_PLUGINS as never}
                        rehypePlugins={REHYPE_PLUGINS as never}
                        components={logMarkdownComponents}
                    >
                        {text}
                    </ReactMarkdown>
                </div>
            )}
            {isToolRole && text && (
                <pre className="font-mono text-[11px] leading-tight whitespace-pre-wrap break-all bg-muted/40 rounded p-2 max-h-60 overflow-auto">
                    {text}
                </pre>
            )}
            {toolCalls.length > 0 && (
                <div className="flex flex-col gap-1">
                    {toolCalls.map((tc, i) => (
                        <LogToolCallCard
                            key={tc.id ?? i}
                            name={tc.function?.name ?? "(unknown)"}
                            args={tc.function?.arguments ?? ""}
                            callId={tc.id}
                        />
                    ))}
                </div>
            )}
            {!text && parts.length === 0 && toolCalls.length === 0 && (
                <p className="text-xs text-muted-foreground italic">(empty)</p>
            )}
        </div>
    )
}

function LogToolCallCard({ name, args, callId }: { name: string; args: string; callId?: string }) {
    const [open, setOpen] = useState(false)
    const pretty = (() => {
        if (!args) return "{}"
        try {
            return JSON.stringify(JSON.parse(args), null, 2)
        } catch {
            return args
        }
    })()
    return (
        <div className="rounded-md border bg-muted/30 overflow-hidden">
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-muted/60 transition-colors"
            >
                <Wrench className="h-3 w-3 text-muted-foreground shrink-0" />
                <span className="font-mono text-[11px] text-foreground truncate flex-1">{name}</span>
                {callId && <span className="text-[10px] text-muted-foreground font-mono truncate">{callId}</span>}
                {open ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
            </button>
            {open && (
                <pre className="border-t font-mono text-[11px] leading-tight whitespace-pre-wrap break-all bg-background/60 p-2 max-h-60 overflow-auto">
                    {pretty}
                </pre>
            )}
        </div>
    )
}

function ImagePreview({ url }: { url: string }) {
    return (
        <a href={url} target="_blank" rel="noreferrer" className="inline-block group">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
                src={url}
                alt="image attachment"
                className="max-h-32 max-w-[12rem] rounded border bg-muted/30 object-contain group-hover:opacity-80 transition"
                loading="lazy"
            />
        </a>
    )
}

function FilePreview({ filename, mime }: { filename: string; mime?: string }) {
    return (
        <span
            className="inline-flex items-center gap-2 rounded border bg-muted/30 px-2 py-1.5 text-xs max-w-[260px]"
            title={mime ? `${filename} (${mime})` : filename}
        >
            <Paperclip className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="truncate">{filename}</span>
        </span>
    )
}
