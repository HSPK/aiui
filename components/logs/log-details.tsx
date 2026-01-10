"use client"

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
import { ScrollArea } from "@/components/ui/scroll-area"
import dynamic from 'next/dynamic'
import { format } from "date-fns"
import { Loader2 } from "lucide-react"

const ReactJson = dynamic(() => import('react-json-view'), { ssr: false })

interface LogDetailsProps {
    logId: string | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function LogDetails({ logId, open, onOpenChange }: LogDetailsProps) {
    const { data: log, isLoading } = useQuery({
        queryKey: ["log", logId],
        queryFn: () => api.getLogDetail(logId!),
        enabled: !!logId && open,
    })

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent className="sm:max-w-xl md:max-w-3xl lg:max-w-4xl w-[90vw] overflow-y-auto">
                <SheetHeader>
                    <SheetTitle>Request Details</SheetTitle>
                    <SheetDescription>
                        Trace ID: {logId}
                    </SheetDescription>
                </SheetHeader>

                {isLoading ? (
                    <div className="flex items-center justify-center h-full">
                        <Loader2 className="h-8 w-8 animate-spin" />
                    </div>
                ) : log ? (
                    <div className="space-y-6 mt-6 pb-10">
                        <div className="flex flex-wrap gap-4 p-4 bg-muted/30 rounded-lg border">
                            <div className="space-y-1 min-w-[100px]">
                                <span className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Status</span>
                                <div>
                                    <Badge variant={log.status === "completed" ? "default" : log.status === "failed" ? "destructive" : "secondary"}>
                                        {log.status}
                                    </Badge>
                                </div>
                            </div>
                            <div className="space-y-1 min-w-[150px]">
                                <span className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Model</span>
                                <div className="font-mono text-sm font-medium">{log.model_name}</div>
                            </div>
                            <div className="space-y-1 min-w-[150px]">
                                <span className="text-xs text-muted-foreground uppercase font-bold tracking-wider">User</span>
                                <div className="text-sm font-medium">{log.user_id}</div>
                            </div>
                            <div className="space-y-1 min-w-[150px]">
                                <span className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Time</span>
                                <div className="text-sm font-mono text-muted-foreground">{format(new Date(log.created_at), "yyyy-MM-dd HH:mm:ss")}</div>
                            </div>
                        </div>

                        {/* Input & Output Section */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <h3 className="text-sm font-bold flex items-center gap-2">
                                    <span className="w-2 h-2 rounded-full bg-blue-500" />
                                    Input / Prompt
                                </h3>
                                <div className="p-3 bg-muted/20 border rounded-md text-sm whitespace-pre-wrap font-mono max-h-[400px] overflow-y-auto">
                                    {log.input || <span className="text-muted-foreground italic">No input recorded</span>}
                                </div>
                            </div>
                            <div className="space-y-2">
                                <h3 className="text-sm font-bold flex items-center gap-2">
                                    <span className="w-2 h-2 rounded-full bg-green-500" />
                                    Output / Completion
                                </h3>
                                <div className="p-3 bg-muted/20 border rounded-md text-sm whitespace-pre-wrap font-mono max-h-[400px] overflow-y-auto">
                                    {log.output || <span className="text-muted-foreground italic">No output recorded</span>}
                                </div>
                            </div>
                        </div>

                        <div>
                            <h3 className="text-sm font-bold mb-2">Generation Parameters</h3>
                            <div className="border rounded-md overflow-hidden bg-card">
                                <div className="p-4 bg-muted/10">
                                    <ReactJson
                                        src={log.generation_kwargs}
                                        name={false}
                                        collapsed
                                        displayDataTypes={false}
                                        enableClipboard
                                        style={{ backgroundColor: 'transparent', fontSize: '13px' }}
                                    />
                                </div>
                            </div>
                        </div>

                        <div>
                            <h3 className="text-sm font-bold mb-2">Raw Output</h3>
                            <div className="border rounded-md overflow-hidden bg-card">
                                <div className="p-4 bg-muted/10">
                                    <ReactJson
                                        src={log.generation?.response || {}}
                                        name={false}
                                        displayDataTypes={false}
                                        enableClipboard
                                        collapsed={1}
                                        style={{ backgroundColor: 'transparent', fontSize: '13px' }}
                                    />
                                </div>
                            </div>
                        </div>

                        {log.reason && (
                            <div className="border-l-4 border-yellow-500 pl-4 py-2 bg-yellow-500/10">
                                <h3 className="text-sm font-bold text-yellow-700 dark:text-yellow-400">Reason/Debug Info</h3>
                                <pre className="text-xs mt-1 whitespace-pre-wrap font-mono">{log.reason}</pre>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="text-center py-10 text-muted-foreground">
                        Failed to load details.
                    </div>
                )}
            </SheetContent>
        </Sheet>
    )
}
