"use client"

import * as React from "react"
import Link from "next/link"
import { Wrench } from "lucide-react"

import { mcpServers } from "@/lib/api"
import { usePlaygroundStore } from "@/lib/stores/playground-store"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

interface Props {
    conversationId: string
}

const EMPTY_IDS: readonly string[] = Object.freeze([])

/** Per-conversation MCP server picker. Every globally-enabled server
 *  is active by default; the popover Switches OFF to add the server
 *  to the conversation's denylist (`disabledMcpServerIds`). */
export function McpToolToggle({ conversationId }: Props) {
    const { data: servers } = mcpServers.useList()
    // Select the raw (possibly undefined) array so the selector returns
    // a stable reference; default in a memo outside the store.
    const disabledRaw = usePlaygroundStore(
        (s) => s.settings[conversationId]?.disabledMcpServerIds
    )
    const updateSettings = usePlaygroundStore((s) => s.updateSettings)

    const disabledIds = React.useMemo(() => disabledRaw ?? EMPTY_IDS, [disabledRaw])
    const available = React.useMemo(
        () => (servers ?? []).filter((s) => s.enabled),
        [servers]
    )
    const disabledSet = React.useMemo(() => new Set(disabledIds), [disabledIds])
    const activeCount = available.filter((s) => !disabledSet.has(s.id)).length

    const toggle = React.useCallback(
        (id: string, on: boolean) => {
            // on = include in this conv → remove from denylist
            // off = exclude from this conv → add to denylist
            const next = on
                ? disabledIds.filter((x) => x !== id)
                : Array.from(new Set([...disabledIds, id]))
            updateSettings(conversationId, { disabledMcpServerIds: next })
        },
        [disabledIds, conversationId, updateSettings]
    )

    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={cn(
                        "h-7 px-2 gap-1.5 text-xs text-muted-foreground hover:text-foreground",
                        activeCount > 0 && "text-foreground"
                    )}
                    title="MCP tools"
                >
                    <Wrench className="h-3.5 w-3.5" />
                    {activeCount > 0 && (
                        <Badge variant="secondary" className="h-4 px-1 text-[10px] font-mono">
                            {activeCount}
                        </Badge>
                    )}
                </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72 p-0">
                <div className="px-3 py-2 border-b">
                    <div className="text-xs font-medium">MCP tools</div>
                </div>
                <div className="max-h-80 overflow-y-auto p-1">
                    {available.length === 0 ? (
                        <div className="p-4 text-center text-xs text-muted-foreground space-y-2">
                            <p>No MCP servers configured.</p>
                            <Link
                                href="/mcp"
                                className="inline-block text-foreground underline underline-offset-2 hover:text-primary"
                            >
                                Add one →
                            </Link>
                        </div>
                    ) : (
                        available.map((s) => {
                            const checked = !disabledSet.has(s.id)
                            return (
                                <label
                                    key={s.id}
                                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-muted/50 cursor-pointer"
                                >
                                    <div className="min-w-0 flex-1">
                                        <div className="truncate font-medium">{s.name}</div>
                                        {s.description && (
                                            <div className="truncate text-[10px] text-muted-foreground">
                                                {s.description}
                                            </div>
                                        )}
                                    </div>
                                    <Switch
                                        checked={checked}
                                        onCheckedChange={(v) => toggle(s.id, v)}
                                    />
                                </label>
                            )
                        })
                    )}
                </div>
            </PopoverContent>
        </Popover>
    )
}
