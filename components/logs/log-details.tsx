"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"
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
import { Loader2, Copy, Check, FileText, Terminal, AlignLeft, Code } from "lucide-react"
import { formatToLocal, cn } from "@/lib/utils"
// @ts-ignore
import ReactMarkdown from 'react-markdown'

const ReactJson = dynamic(() => import('react-json-view'), { ssr: false })

interface LogDetailsProps {
    logId: string | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

function CopyButton({ text }: { text: string }) {
    const [copied, setCopied] = useState(false)

    const handleCopy = () => {
        navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }

    return (
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleCopy}>
            {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3 text-muted-foreground" />}
        </Button>
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
                <div className="p-3 text-sm min-h-[100px] max-h-[500px] overflow-y-auto custom-scrollbar">
                    {viewMode === "preview" ? (
                        <div className="prose prose-sm dark:prose-invert max-w-none break-words leading-relaxed">
                            <ReactMarkdown>{content}</ReactMarkdown>
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
    const { data: log, isLoading } = useQuery({
        queryKey: ["log", logId],
        queryFn: () => api.getLogDetail(logId!),
        enabled: !!logId && open,
    })

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
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-card rounded-lg border shadow-sm">
                            <div className="space-y-1">
                                <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider flex items-center gap-1">
                                    <Terminal className="h-3 w-3" /> Model
                                </span>
                                <div className="font-mono text-sm font-medium">{log.model_name}</div>
                            </div>
                            <div className="space-y-1">
                                <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">User</span>
                                <div className="text-sm font-medium truncate" title={log.user_id}>{log.user_id}</div>
                            </div>
                            <div className="space-y-1">
                                <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Time</span>
                                <div className="text-sm font-mono text-muted-foreground">
                                    {formatToLocal(log.created_at, "MM-dd HH:mm:ss")}
                                </div>
                            </div>
                            <div className="space-y-1">
                                <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Latency</span>
                                <div className="text-sm font-mono">
                                    -
                                </div>
                            </div>
                        </div>

                        {/* Input & Output Section */}
                        <div className="flex flex-col lg:flex-row gap-6">
                            <ContentViewer
                                title="Prompt"
                                content={log.input}
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
                                    <div className="flex items-center gap-2 text-sm font-semibold">
                                        <FileText className="h-4 w-4" /> Generation Parameters
                                    </div>
                                </AccordionTrigger>
                                <AccordionContent className="pb-4">
                                    <div className="p-4 bg-muted/30 rounded-md border text-sm">
                                        <ReactJson
                                            src={log.generation_kwargs || {}}
                                            name={false}
                                            collapsed={false}
                                            displayDataTypes={false}
                                            enableClipboard
                                            style={{ backgroundColor: 'transparent', fontSize: '12px' }}
                                        />
                                    </div>
                                </AccordionContent>
                            </AccordionItem>

                            <AccordionItem value="raw" className="px-4 border-none">
                                <AccordionTrigger className="hover:no-underline py-3">
                                    <div className="flex items-center gap-2 text-sm font-semibold">
                                        <Code className="h-4 w-4" /> Raw Output
                                    </div>
                                </AccordionTrigger>
                                <AccordionContent className="pb-4">
                                    <div className="p-4 bg-muted/30 rounded-md border text-sm">
                                        <ReactJson
                                            src={log?.generation || {}}
                                            name={false}
                                            displayDataTypes={false}
                                            enableClipboard
                                            collapsed={1}
                                            style={{ backgroundColor: 'transparent', fontSize: '12px' }}
                                        />
                                    </div>
                                </AccordionContent>
                            </AccordionItem>
                        </Accordion>

                        {log.reason && (
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
