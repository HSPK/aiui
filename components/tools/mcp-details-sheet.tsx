"use client"

import * as React from "react"
import { toast } from "sonner"
import { Wrench } from "lucide-react"

import { mcpServers } from "@/lib/api"
import type { McpServerDTO } from "@/lib/schemas/mcp"
import { Badge } from "@/components/ui/badge"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import {
    EndpointSection,
    HealthSection,
    PromptsSection,
    ResourcesSection,
    ServerInfoSection,
    ToolsSection,
} from "./_parts/sections"

interface Props {
    server: McpServerDTO | null
    open: boolean
    onOpenChange: (open: boolean) => void
    isAdmin: boolean
}

/**
 * Read-only details panel for one MCP server. Composes per-capability
 * sections from `_parts/sections.tsx`; adding a new MCP capability
 * surface only requires writing a new section component there and one
 * invocation below — the shell stays small.
 */
export function McpServerDetailsSheet({ server, open, onOpenChange, isAdmin }: Props) {
    const check = mcpServers.useCheck({
        onSuccess: (s) => {
            if (s.last_check_status === "ok") {
                toast.success(`Check passed — ${s.tools_cache?.length ?? 0} tools`)
            } else {
                const first = (s.last_check_error ?? "unknown error").split("\n", 1)[0]
                toast.error(`Check failed: ${first}`)
            }
        },
        onError: (e) => toast.error(e.message || "Check failed"),
    })

    const runCheck = React.useCallback(() => {
        if (!server) return
        check.mutate(server.id)
    }, [server, check])

    // Silent backfill: rows created before the server_info column
    // existed have it null even when the server is healthy. Trigger
    // a re-check on first open so the section populates without
    // forcing the user to hunt for the button.
    const backfillIdRef = React.useRef<string | null>(null)
    React.useEffect(() => {
        if (!open || !server) return
        if (server.server_info) return
        if (server.last_check_status !== "ok") return
        if (backfillIdRef.current === server.id) return
        backfillIdRef.current = server.id
        check.mutate(server.id)
    }, [open, server, check])

    if (!server) return null

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent side="right" className="w-full sm:max-w-[640px] overflow-y-auto scrollbar-thin p-0">
                <SheetHeader className="px-6 py-4 border-b">
                    <SheetTitle className="flex items-center gap-2 text-base">
                        <Wrench className="h-4 w-4 text-muted-foreground" />
                        <span className="font-mono">{server.name}</span>
                        <Badge variant="outline" className="text-[10px] uppercase ml-2">
                            {server.transport}
                        </Badge>
                        {!server.enabled && (
                            <Badge variant="secondary" className="text-[10px] uppercase">
                                disabled
                            </Badge>
                        )}
                    </SheetTitle>
                    <SheetDescription className="text-xs text-muted-foreground pt-1">
                        {server.description || "MCP server connection details, health, and discovered tools."}
                    </SheetDescription>
                </SheetHeader>

                <div className="px-6 py-4 space-y-5">
                    <HealthSection server={server} onCheck={runCheck} isChecking={check.isPending} isAdmin={isAdmin} />
                    {server.server_info && <ServerInfoSection info={server.server_info} />}
                    <EndpointSection server={server} isAdmin={isAdmin} />
                    <ToolsSection tools={server.tools_cache ?? []} status={server.last_check_status} />
                    <ResourcesSection
                        snapshot={server.resources_cache}
                        capabilityAdvertised={!!server.server_info?.capabilities?.resources}
                        status={server.last_check_status}
                    />
                    <PromptsSection
                        prompts={server.prompts_cache}
                        capabilityAdvertised={!!server.server_info?.capabilities?.prompts}
                        status={server.last_check_status}
                    />
                </div>
            </SheetContent>
        </Sheet>
    )
}
