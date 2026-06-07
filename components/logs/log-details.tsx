"use client"

import { logs } from "@/lib/api";
import { useMemo, useState } from "react"
import { capabilityLabel } from "@/components/providers/capability-label"

import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetDescription,
} from "@/components/ui/sheet"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@/components/ui/accordion"
import dynamic from 'next/dynamic'
import { Loader2, Copy, Check, FileText, Terminal, AlignLeft, Code, Download } from "lucide-react"
import { formatToLocal, cn } from "@/lib/utils"
// @ts-ignore
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { useTheme } from "next-themes"

const ReactJson = dynamic(() => import('react-json-view'), { ssr: false })

// Markdown components for log details with full GFM support
const logMarkdownComponents = {
    // Code blocks
    pre: ({ children }: any) => <>{children}</>,
    code: ({ node, inline, className, children, ...props }: any) => {
        const codeString = String(children).replace(/\n$/, '')
        if (!inline) {
            return (
                <pre className="my-2 p-3 bg-muted/50 rounded-md overflow-x-auto border">
                    <code className="text-xs font-mono">{codeString}</code>
                </pre>
            )
        }
        return (
            <code className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono" {...props}>
                {children}
            </code>
        )
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
                    className="mt-1 h-4 w-4 rounded border-border text-primary"
                    {...props}
                />
            )
        }
        return <input type={type} {...props} />
    },
    // Blockquote
    blockquote: ({ children }: any) => (
        <blockquote className="my-3 border-l-4 border-primary/30 pl-4 italic text-muted-foreground">{children}</blockquote>
    ),
    // Horizontal rule
    hr: () => <hr className="my-4 border-border" />,
    // Links
    a: ({ href, children }: any) => (
        <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2 hover:text-primary/80">{children}</a>
    ),
    // Strikethrough
    del: ({ children }: any) => (
        <del className="text-muted-foreground line-through">{children}</del>
    ),
    // Strong/Bold
    strong: ({ children }: any) => (
        <strong className="font-semibold text-foreground">{children}</strong>
    ),
    // Headings
    h1: ({ children }: any) => <h1 className="mt-4 mb-2 text-xl font-bold">{children}</h1>,
    h2: ({ children }: any) => <h2 className="mt-3 mb-2 text-lg font-bold">{children}</h2>,
    h3: ({ children }: any) => <h3 className="mt-3 mb-1 text-base font-semibold">{children}</h3>,
    h4: ({ children }: any) => <h4 className="mt-2 mb-1 text-sm font-semibold">{children}</h4>,
    // Paragraph
    p: ({ children }: any) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
}

interface LogDetailsProps {
    logId: string | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

function CopyButton({ text, className }: { text: string, className?: string }) {
    const [copied, setCopied] = useState(false)

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(text)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        } catch (err) {
            console.error('Failed to copy:', err)
        }
    }

    return (
        <Button variant="ghost" size="icon" className={cn("h-6 w-6", className)} onClick={handleCopy} title="Copy to clipboard">
            {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3 text-muted-foreground" />}
        </Button>
    )
}

function JsonActionButtons({ data, filename, onClick }: { data: object, filename: string, onClick?: (e: React.MouseEvent) => void }) {
    const jsonString = useMemo(() => JSON.stringify(data, null, 2), [data])
    const [copied, setCopied] = useState(false)

    const handleCopy = async (e: React.MouseEvent) => {
        e.stopPropagation()
        onClick?.(e)
        try {
            await navigator.clipboard.writeText(jsonString)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        } catch (err) {
            console.error('Failed to copy:', err)
        }
    }

    const handleDownload = (e: React.MouseEvent) => {
        e.stopPropagation()
        onClick?.(e)
        const blob = new Blob([jsonString], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
    }

    return (
        <div className="flex items-center gap-0.5 ml-auto mr-2">
            <div
                role="button"
                tabIndex={0}
                className="inline-flex items-center justify-center h-6 w-6 text-muted-foreground hover:text-foreground hover:bg-muted/80 rounded-md cursor-pointer"
                onClick={handleCopy}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleCopy(e as unknown as React.MouseEvent) }}
                title="Copy JSON"
            >
                {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
            </div>
            <div
                role="button"
                tabIndex={0}
                className="inline-flex items-center justify-center h-6 w-6 text-muted-foreground hover:text-foreground hover:bg-muted/80 rounded-md cursor-pointer"
                onClick={handleDownload}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleDownload(e as unknown as React.MouseEvent) }}
                title="Download JSON"
            >
                <Download className="h-3.5 w-3.5" />
            </div>
        </div>
    )
}

function ContentViewer({ title, content, colorClass }: { title: string, content: string | null, colorClass: string }) {
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
                                remarkPlugins={[remarkMath, remarkGfm]}
                                rehypePlugins={[rehypeKatex]}
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

export function LogDetails({ logId, open, onOpenChange }: LogDetailsProps) {
    const { resolvedTheme } = useTheme()
    const { data: log, isLoading } = logs.useGet(open ? logId : null)

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent className="sm:max-w-xl md:max-w-3xl lg:max-w-4xl w-[90vw] overflow-y-auto p-0 gap-0 flex flex-col">
                <SheetHeader className="px-6 py-4 border-b bg-muted/40 sticky top-0 z-10 backdrop-blur-sm shrink-0">
                    <div className="flex items-center justify-between mr-8">
                        <div className="space-y-1">
                            <SheetTitle>Trace Details</SheetTitle>
                            <SheetDescription className="flex items-center gap-2 font-mono text-xs">
                                {logId} <CopyButton text={logId || ""} />
                            </SheetDescription>
                        </div>
                        {log && (
                            <Badge variant={log.status === "completed" ? "default" : log.status === "failed" ? "destructive" : "secondary"}>
                                {log.status}
                            </Badge>
                        )}
                    </div>
                </SheetHeader>

                {isLoading ? (
                    <div className="flex items-center justify-center flex-1">
                        <Loader2 className="h-8 w-8 animate-spin" />
                    </div>
                ) : log ? (
                    <div className="px-6 py-6 space-y-8 flex-1 overflow-y-auto">
                        {/* KPI Grid */}
                        <div className="grid grid-cols-2 md:grid-cols-[1.5fr_1fr_1fr_1fr_0.7fr_0.7fr] gap-4 p-4 bg-card rounded-lg border shadow-sm">
                            <div className="space-y-1">
                                <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider flex items-center gap-1">
                                    <Terminal className="h-3 w-3" /> Model
                                </span>
                                <div title={log.model_name}>
                                    <Badge variant="outline" className="font-mono text-xs font-normal h-auto whitespace-normal text-left break-all">
                                        {log.model_name}
                                    </Badge>
                                </div>
                            </div>
                            <div className="space-y-1">
                                <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Capability</span>
                                <div>
                                    <Badge variant="secondary" className="text-xs font-normal">{capabilityLabel(log.capability)}</Badge>
                                </div>
                            </div>
                            <div className="space-y-1 overflow-hidden">
                                <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">User</span>
                                <div
                                    className="text-sm font-medium truncate"
                                    title={log.username ? `${log.username} (${log.user_id})` : log.user_id}
                                >
                                    {log.username || log.user_id}
                                </div>
                            </div>
                            <div className="space-y-1">
                                <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Time</span>
                                <div className="text-sm font-mono text-muted-foreground whitespace-nowrap">
                                    {formatToLocal(log.created_at, "MM-dd HH:mm:ss")}
                                </div>
                            </div>
                            <div className="space-y-1">
                                <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Tokens</span>
                                <div
                                    className="text-sm font-mono"
                                    title={
                                        log.prompt_tokens != null || log.completion_tokens != null
                                            ? `prompt: ${log.prompt_tokens ?? "—"} / completion: ${log.completion_tokens ?? "—"}`
                                            : undefined
                                    }
                                >
                                    {log.total_tokens != null ? log.total_tokens.toLocaleString() : "—"}
                                </div>
                            </div>
                            <div className="space-y-1">
                                <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">TTFT</span>
                                <div
                                    className="text-sm font-mono"
                                    title="Time to first token (streaming only)"
                                >
                                    {log.first_token_latency_ms != null
                                        ? log.first_token_latency_ms < 1000
                                            ? `${log.first_token_latency_ms}ms`
                                            : `${(log.first_token_latency_ms / 1000).toFixed(2)}s`
                                        : "—"}
                                </div>
                            </div>
                            <div className="space-y-1">
                                <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Total Latency</span>
                                <div
                                    className="text-sm font-mono"
                                    title="End-to-end latency from request start to response fully consumed"
                                >
                                    {log.total_latency_ms != null
                                        ? log.total_latency_ms < 1000
                                            ? `${log.total_latency_ms}ms`
                                            : `${(log.total_latency_ms / 1000).toFixed(2)}s`
                                        : "—"}
                                </div>
                            </div>
                        </div>

                        {/* Input & Output Section */}
                        <div className="flex flex-col lg:flex-row gap-6">
                            <ContentViewer
                                title="Prompt"
                                content={log.input_summary ?? (typeof log.input === "string" ? log.input : null)}
                                colorClass="bg-blue-500"
                            />
                            <ContentViewer
                                title="Completion"
                                content={log.output}
                                colorClass="bg-green-500"
                            />
                        </div>

                        {/* Technical Details */}
                        <Accordion type="single" collapsible className="w-full border rounded-lg bg-card">
                            <AccordionItem value="params" className="border-b px-4">
                                <AccordionTrigger className="hover:no-underline py-3">
                                    <div className="flex items-center w-full">
                                        <div className="flex items-center gap-2 text-sm font-semibold">
                                            <FileText className="h-4 w-4" /> Generation Parameters
                                        </div>
                                        <JsonActionButtons
                                            data={log.generation_kwargs || {}}
                                            filename={`generation-params-${logId}.json`}
                                        />
                                    </div>
                                </AccordionTrigger>
                                <AccordionContent className="pb-4">
                                    <div className="p-4 bg-muted/30 rounded-md border text-sm">
                                        <ReactJson
                                            src={log.generation_kwargs || {}}
                                            name={false}
                                            collapsed={false}
                                            displayDataTypes={false}
                                            enableClipboard={false}
                                            theme={resolvedTheme === 'dark' ? 'monokai' : 'rjv-default'}
                                            style={{ backgroundColor: 'transparent', fontSize: '12px' }}
                                        />
                                    </div>
                                </AccordionContent>
                            </AccordionItem>

                            <AccordionItem value="raw" className="px-4 border-none">
                                <AccordionTrigger className="hover:no-underline py-3">
                                    <div className="flex items-center w-full">
                                        <div className="flex items-center gap-2 text-sm font-semibold">
                                            <Code className="h-4 w-4" /> Raw Output
                                        </div>
                                        <JsonActionButtons
                                            data={log?.generation || {}}
                                            filename={`raw-output-${logId}.json`}
                                        />
                                    </div>
                                </AccordionTrigger>
                                <AccordionContent className="pb-4">
                                    <div className="p-4 bg-muted/30 rounded-md border text-sm">
                                        <ReactJson
                                            src={log?.generation || {}}
                                            name={false}
                                            displayDataTypes={false}
                                            enableClipboard={false}
                                            collapsed={1}
                                            theme={resolvedTheme === 'dark' ? 'monokai' : 'rjv-default'}
                                            style={{ backgroundColor: 'transparent', fontSize: '12px' }}
                                        />
                                    </div>
                                </AccordionContent>
                            </AccordionItem>
                        </Accordion>

                        {log.reason && log.reason !== "success" && (
                            <div className="border-l-4 border-yellow-500 pl-4 py-3 bg-yellow-500/10 rounded-r-md">
                                <h3 className="text-sm font-bold text-yellow-700 dark:text-yellow-400 mb-1">Debug Info</h3>
                                <pre className="text-xs whitespace-pre-wrap font-mono text-muted-foreground">{log.reason}</pre>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="text-center py-20 text-muted-foreground">
                        Failed to load details.
                    </div>
                )}
            </SheetContent>
        </Sheet>
    )
}
