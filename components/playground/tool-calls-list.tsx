"use client"

import * as React from "react"
import { AlertTriangle, ChevronDown, ChevronRight, Loader2, Wrench } from "lucide-react"

import type { AssembledToolCall } from "@/components/playground/chat/types"
import { cn } from "@/lib/utils"

/**
 * Compact, count-aware rendering of a turn's tool_calls.
 *
 * Why a separate component:
 *   - chat-message.tsx is already large, and tool-call rendering has
 *     its own visual contract (status icons, expand-inline, grouping)
 *     that doesn't share much with bubble / markdown rendering.
 *
 * Visual contract:
 *   - One bordered group per turn, header lists overall counts.
 *   - When ≤ AUTO_EXPAND_THRESHOLD calls, the rows render expanded
 *     by default — small turns shouldn't make the user click.
 *   - When more, the rows are collapsed under the header; the user
 *     clicks the header to spread them. The summary still tells the
 *     story at a glance (OK / error / running counts).
 *   - Each row is a single line — icon + qualified name + status
 *     suffix. Click a row to expand inline args + result.
 *
 * Status comes from the call's result:
 *   - no result yet           → running  (live stream still in flight)
 *   - result.is_error truthy  → error
 *   - else                    → ok
 */

const AUTO_EXPAND_THRESHOLD = 3

type CallStatus = "ok" | "error" | "running"

function statusOf(call: AssembledToolCall): CallStatus {
    if (!call.result) return "running"
    return call.result.is_error ? "error" : "ok"
}

function prettyJson(s: string): string {
    if (!s) return ""
    try {
        return JSON.stringify(JSON.parse(s), null, 2)
    } catch {
        return s
    }
}

export function ToolCallsList({ calls }: { calls: AssembledToolCall[] }) {
    const stats = React.useMemo(() => {
        let ok = 0
        let err = 0
        let running = 0
        for (const c of calls) {
            const s = statusOf(c)
            if (s === "ok") ok += 1
            else if (s === "error") err += 1
            else running += 1
        }
        return { ok, err, running }
    }, [calls])

    const [open, setOpen] = React.useState(calls.length <= AUTO_EXPAND_THRESHOLD)
    const headerTone = stats.err > 0
        ? "border-destructive/30 bg-destructive/5"
        : stats.running > 0
            ? "border-border bg-muted/30"
            : "border-border bg-muted/30"

    return (
        <div className={cn("not-prose my-2 rounded-lg border overflow-hidden text-xs", headerTone)}>
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-muted/50 transition-colors"
            >
                <Wrench className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="font-medium">
                    {calls.length} tool call{calls.length === 1 ? "" : "s"}
                </span>
                <span className="text-muted-foreground">·</span>
                <StatPills stats={stats} />
                {open
                    ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground ml-auto" />
                    : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground ml-auto" />}
            </button>

            {open && (
                <ul className="border-t border-border bg-background/40 divide-y divide-border/60 max-h-[420px] overflow-auto">
                    {calls.map((c, i) => (
                        <ToolCallRow key={c.id || `${c.name}-${i}`} call={c} />
                    ))}
                </ul>
            )}
        </div>
    )
}

function StatPills({ stats }: { stats: { ok: number; err: number; running: number } }) {
    const parts: React.ReactNode[] = []
    if (stats.ok > 0) {
        parts.push(
            <span key="ok" className="text-emerald-600 dark:text-emerald-400">
                {stats.ok} ok
            </span>,
        )
    }
    if (stats.err > 0) {
        parts.push(
            <span key="err" className="text-destructive">{stats.err} error{stats.err === 1 ? "" : "s"}</span>,
        )
    }
    if (stats.running > 0) {
        parts.push(
            <span key="run" className="text-muted-foreground inline-flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" />
                {stats.running} running
            </span>,
        )
    }
    return (
        <span className="flex items-center gap-2 text-[11px]">
            {parts.length === 0 ? <span className="text-muted-foreground">empty</span> : parts.map((p, i) => (
                <React.Fragment key={i}>
                    {i > 0 && <span className="text-muted-foreground/60">·</span>}
                    {p}
                </React.Fragment>
            ))}
        </span>
    )
}

function ToolCallRow({ call }: { call: AssembledToolCall }) {
    const [open, setOpen] = React.useState(false)
    const status = statusOf(call)

    const icon = status === "running"
        ? <Loader2 className="h-3 w-3 animate-spin text-muted-foreground shrink-0" />
        : status === "error"
            ? <AlertTriangle className="h-3 w-3 text-destructive shrink-0" />
            : <Wrench className="h-3 w-3 text-muted-foreground shrink-0" />

    return (
        <li className={cn(status === "error" && "bg-destructive/5")}>
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className="w-full flex items-center gap-2 px-2.5 py-1 text-left hover:bg-muted/50 transition-colors"
            >
                {icon}
                <span className="font-mono text-[11px] text-foreground truncate flex-1 min-w-0">
                    {call.source && <span className="text-muted-foreground">{call.source}/</span>}
                    {call.name}
                </span>
                {status === "error" && (
                    <span className="text-[10px] uppercase tracking-wide text-destructive">err</span>
                )}
                {open
                    ? <ChevronDown className="h-3 w-3 text-muted-foreground" />
                    : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
            </button>
            {open && (
                <div className="border-t border-border/60 bg-background/70 px-2.5 py-2 space-y-2">
                    <DetailBlock label="Arguments" body={prettyJson(call.arguments) || "{}"} />
                    {call.result && (
                        <DetailBlock
                            label={call.result.is_error ? "Result (error)" : "Result"}
                            body={call.result.content}
                            isError={call.result.is_error}
                        />
                    )}
                </div>
            )}
        </li>
    )
}

function DetailBlock({ label, body, isError }: { label: string; body: string; isError?: boolean }) {
    return (
        <div>
            <div className={cn(
                "text-[10px] uppercase tracking-wide mb-1",
                isError ? "text-destructive" : "text-muted-foreground",
            )}>
                {label}
            </div>
            <pre className="font-mono text-[11px] leading-snug whitespace-pre-wrap break-words bg-muted/40 rounded p-2 max-h-72 overflow-auto">
                {body}
            </pre>
        </div>
    )
}
