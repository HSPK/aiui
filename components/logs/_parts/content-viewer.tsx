"use client"

import { useState } from "react"
import { AlignLeft, Code } from "lucide-react"
// @ts-ignore - react-markdown types
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import rehypeKatex from "rehype-katex"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import { logMarkdownComponents } from "./markdown"
import { CopyButton } from "./json-tools"

// Stable plugin arrays — see chat-message.tsx for the same rationale.
// react-markdown rebuilds its unified processor when these change.
const REMARK_PLUGINS = [remarkMath, remarkGfm] as const
const REHYPE_PLUGINS = [rehypeKatex] as const

/**
 * Renders one log column (Prompt / Completion / Reasoning) with
 * a Preview ↔ Raw toggle. Empty content shows a dashed-border
 * "no content" placeholder. Used by panels whose input isn't
 * chat-shaped (embedding / image / audio) — chat-shaped inputs
 * use <RequestPreview> instead.
 */
export function ContentViewer({
    title,
    content,
    colorClass,
}: {
    title: string
    content: string | null
    colorClass: string
}) {
    const [viewMode, setViewMode] = useState<"preview" | "raw">("preview")

    if (!content) return (
        <div className="space-y-2 flex-1 min-w-[300px]">
            <h3 className="text-sm font-bold flex items-center gap-2">
                <span className={cn("w-2 h-2 rounded-full", colorClass)} />
                {title}
            </h3>
            <div className="p-3 bg-muted/10 border border-dashed rounded-md text-sm italic text-muted-foreground">
                No content recorded
            </div>
        </div>
    )

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
                    <CopyButton text={content} />
                </div>
            </div>

            <div className="border rounded-md overflow-hidden bg-muted/20">
                <div className="p-3 text-sm min-h-[100px] max-h-[500px] overflow-y-auto scrollbar-thin">
                    {viewMode === "preview" ? (
                        <div className="prose prose-sm dark:prose-invert max-w-none break-words leading-relaxed">
                            <ReactMarkdown
                                remarkPlugins={REMARK_PLUGINS as never}
                                rehypePlugins={REHYPE_PLUGINS as never}
                                components={logMarkdownComponents}
                            >
                                {content}
                            </ReactMarkdown>
                        </div>
                    ) : (
                        <pre className="text-xs font-mono whitespace-pre-wrap break-all text-muted-foreground">
                            {content}
                        </pre>
                    )}
                </div>
            </div>
        </div>
    )
}
