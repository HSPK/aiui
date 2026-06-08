"use client"

import { logs } from "@/lib/api";
import { useState } from "react"
import { capabilityLabel } from "@/components/providers/capability-label"

import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetDescription,
} from "@/components/ui/sheet"
import { Badge } from "@/components/ui/badge"
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@/components/ui/accordion"
import dynamic from 'next/dynamic'
import { Loader2, FileText, Terminal, Code, Image as ImageIcon, Paperclip } from "lucide-react"
import { formatToLocal, cn } from "@/lib/utils"
import { useTheme } from "next-themes"

import { CopyButton, JsonActionButtons, sanitizeForJsonView } from "./_parts/json-tools"
import { ContentViewer } from "./_parts/content-viewer"
import { RequestPreview } from "./_parts/message-preview"

const ReactJson = dynamic(() => import('react-json-view'), { ssr: false })

interface LogDetailsProps {
    logId: string | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function LogDetails({ logId, open, onOpenChange }: LogDetailsProps) {
    const { resolvedTheme } = useTheme()
    const { data: log, isLoading } = logs.useGet(open ? logId : null)

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent className="sm:max-w-xl md:max-w-3xl lg:max-w-4xl w-[90vw] overflow-y-auto p-0 gap-0 flex flex-col">
                <SheetHeader className="px-6 py-4 border-b bg-muted/40 sticky top-0 z-10 backdrop-blur-sm shrink-0">
                    <div className="flex items-start justify-between gap-4 mr-8">
                        <div className="min-w-0 space-y-1">
                            <SheetTitle>Trace Details</SheetTitle>
                            <SheetDescription className="flex items-center gap-2 font-mono text-xs">
                                <span className="truncate">{logId}</span>
                                <CopyButton text={logId || ""} />
                            </SheetDescription>
                        </div>
                        {log && (
                            <div className="flex items-center gap-2 shrink-0">
                                <span className="text-[11px] font-mono text-muted-foreground whitespace-nowrap">
                                    {formatToLocal(log.created_at, "MM-dd HH:mm:ss")}
                                </span>
                                <Badge variant={log.status === "completed" ? "default" : log.status === "failed" ? "destructive" : "secondary"}>
                                    {log.status}
                                </Badge>
                            </div>
                        )}
                    </div>
                </SheetHeader>

                {isLoading ? (
                    <div className="flex items-center justify-center flex-1">
                        <Loader2 className="h-8 w-8 animate-spin" />
                    </div>
                ) : log ? (
                    <div className="px-6 py-6 space-y-8 flex-1 overflow-y-auto">
                        {/* KPI Grid — 6 metrics, single row at lg. Time
                         *  lives in the header so we never wrap. */}
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-[1.5fr_1fr_1fr_0.8fr_0.8fr_0.8fr] gap-4 p-4 bg-card rounded-lg border shadow-sm">
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
                                <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Latency</span>
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
                            <RequestPreview
                                title="Prompt"
                                input={log.input}
                                fallback={log.input_summary ?? (typeof log.input === "string" ? log.input : null)}
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
                                            src={sanitizeForJsonView(log.generation_kwargs || {}) as object}
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
                                            src={sanitizeForJsonView(log?.generation || {}) as object}
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

