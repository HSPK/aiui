"use client"

import * as React from "react"
import { CheckCircle2, ExternalLink, Loader2, Power, RefreshCcw, RotateCw, XCircle } from "lucide-react"

import type {
    McpRuntimeStatusDTO,
    McpServerDTO,
    McpServerInfo,
    McpPromptDescriptor,
    McpResourcesSnapshot,
    McpToolDescriptor,
} from "@/lib/schemas/mcp"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn, formatToLocal } from "@/lib/utils"

/** Per-section components for the MCP details sheet.
 *  Co-located so adding a new MCP capability surface
 *  (e.g. "Sampling", "Roots") = 1 new function below + 1
 *  invocation in the sheet shell. */

function isSecretKey(k: string): boolean {
    return /token|secret|key|password|auth/i.test(k)
}

function StatusDot({ status }: { status: "ok" | "error" | null }) {
    if (status === "ok") return <CheckCircle2 className="h-4 w-4 text-emerald-500" />
    if (status === "error") return <XCircle className="h-4 w-4 text-destructive" />
    return <Loader2 className="h-4 w-4 text-muted-foreground animate-spin" />
}

function EmptyHint({ children }: { children: React.ReactNode }) {
    return (
        <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground italic">
            {children}
        </div>
    )
}

function Tag({ children }: { children: React.ReactNode }) {
    return (
        <span className="not-italic inline-flex items-center rounded border border-border bg-muted/40 px-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground mx-0.5">
            {children}
        </span>
    )
}

export function HealthSection({
    server,
    onCheck,
    isChecking,
    isAdmin,
    streaming,
}: {
    server: McpServerDTO
    onCheck: () => void
    isChecking: boolean
    isAdmin: boolean
    /** Optional live-stream state for the in-flight check. When provided,
     *  the phase badge + log panel render while the check is running and
     *  for a few moments after so admins can review what just happened.
     *  Falls back to the legacy spinner-only behaviour when absent. */
    streaming?: {
        phase: "spawning" | "starting" | "connecting" | "listing" | "ready" | null
        logs: string[]
        error: string | null
    }
}) {
    const status = server.last_check_status
    const checkedAt = server.last_check_at ? formatToLocal(server.last_check_at) : "never"
    const phaseLabel = streaming?.phase ? PHASE_LABELS[streaming.phase] : null
    const hasLiveLogs = !!streaming && (isChecking || streaming.logs.length > 0)
    return (
        <section className="space-y-2">
            <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Health</h3>
                {isAdmin && (
                    <Button size="sm" variant="outline" onClick={onCheck} disabled={isChecking} className="h-7 text-xs">
                        {isChecking
                            ? <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                            : <RefreshCcw className="h-3 w-3 mr-1.5" />}
                        Re-check
                    </Button>
                )}
            </div>
            <div className="rounded-md border p-3 text-sm space-y-1.5">
                <div className="flex items-center gap-2">
                    <StatusDot status={isChecking ? null : status} />
                    <span className="font-medium">
                        {isChecking && (phaseLabel ?? "Checking…")}
                        {!isChecking && status === "ok" && "Connected"}
                        {!isChecking && status === "error" && "Failed"}
                        {!isChecking && status === null && "Never checked"}
                    </span>
                    {isChecking && phaseLabel && (
                        <Badge variant="outline" className="ml-auto text-[10px] uppercase tracking-wider">
                            {streaming?.phase}
                        </Badge>
                    )}
                </div>
                <div className="text-[11px] text-muted-foreground">Last check: {checkedAt}</div>
                {hasLiveLogs && (
                    <CheckLogPanel logs={streaming!.logs} isStreaming={isChecking} />
                )}
                {!isChecking && status === "error" && server.last_check_error && (
                    <pre className="mt-1.5 font-mono text-[11px] leading-snug whitespace-pre-wrap break-words bg-destructive/10 text-destructive rounded p-2 max-h-72 overflow-auto">
                        {server.last_check_error}
                    </pre>
                )}
            </div>
        </section>
    )
}

const PHASE_LABELS: Record<string, string> = {
    spawning: "Spawning…",
    starting: "Installing / starting…",
    connecting: "Connecting…",
    listing: "Fetching tools…",
    ready: "Ready",
}

function CheckLogPanel({ logs, isStreaming }: { logs: string[]; isStreaming: boolean }) {
    const scrollRef = React.useRef<HTMLDivElement | null>(null)
    React.useEffect(() => {
        const el = scrollRef.current
        if (el) el.scrollTop = el.scrollHeight
    }, [logs.length])

    return (
        <div className="mt-2 rounded border border-border bg-muted/30">
            <div className="flex items-center justify-between border-b border-border px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                <span>Install / startup logs</span>
                <span>{logs.length} line{logs.length === 1 ? "" : "s"}</span>
            </div>
            <div
                ref={scrollRef}
                className="max-h-56 overflow-auto scrollbar-thin px-2 py-1.5 font-mono text-[11px] leading-snug whitespace-pre-wrap break-words"
            >
                {logs.length === 0 ? (
                    <span className="italic text-muted-foreground">
                        {isStreaming ? "Waiting for output…" : "No output captured."}
                    </span>
                ) : (
                    logs.map((line, i) => <div key={i}>{line || "\u00a0"}</div>)
                )}
            </div>
        </div>
    )
}

// =============================================================================
// RuntimeSection — admin's live view of the in-process MCP runtime
// =============================================================================
//
// Shows the in-memory state machine snapshot from getMcpRuntimeStatus:
//   * traffic-light status badge
//   * child PID + uptime (stdio only)
//   * built_for vs server.config_version — flags a config drift
//   * Stop / Restart controls (admin)
//   * tail of the persisted log file (stderr + lifecycle)
//
// Distinct from HealthSection (which shows the DB-persisted last_check_*
// snapshot). Both panels read the same server but answer different
// questions: "did the most recent admin check pass" vs "what's the live
// process doing right now".

const RUNTIME_STATUS_LABELS: Record<string, string> = {
    idle: "Idle",
    connecting: "Connecting…",
    connected: "Connected",
    failed: "Failed",
}

function RuntimeStatusBadge({ status }: { status: McpRuntimeStatusDTO["status"] }) {
    const tone =
        status === "connected"
            ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30"
            : status === "connecting"
                ? "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30"
                : status === "failed"
                    ? "bg-destructive/15 text-destructive border-destructive/30"
                    : "bg-muted text-muted-foreground border-border"
    return (
        <span className={cn("inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider border", tone)}>
            {status === "connecting" && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
            {RUNTIME_STATUS_LABELS[status] ?? status}
        </span>
    )
}

function formatUptime(startedAt: string): string {
    const ms = Date.now() - new Date(startedAt).getTime()
    if (!Number.isFinite(ms) || ms < 0) return "—"
    const sec = Math.floor(ms / 1000)
    if (sec < 60) return `${sec}s`
    const min = Math.floor(sec / 60)
    if (min < 60) return `${min}m ${sec % 60}s`
    const hr = Math.floor(min / 60)
    return `${hr}h ${min % 60}m`
}

export function RuntimeSection({
    server,
    runtime,
    isLoading,
    isAdmin,
    onStop,
    onRestart,
    isStopping,
    isRestarting,
}: {
    server: McpServerDTO
    runtime: McpRuntimeStatusDTO | null
    isLoading: boolean
    isAdmin: boolean
    onStop: () => void
    onRestart: () => void
    isStopping: boolean
    isRestarting: boolean
}) {
    // Force a re-render every 5s so uptime ticks even between API polls.
    const [, setTick] = React.useState(0)
    React.useEffect(() => {
        if (runtime?.status !== "connected" || !runtime.started_at) return
        const t = setInterval(() => setTick((n) => n + 1), 5_000)
        return () => clearInterval(t)
    }, [runtime?.status, runtime?.started_at])

    const status = runtime?.status ?? "idle"
    const isStdio = server.transport === "stdio"
    const isBusy = isStopping || isRestarting || status === "connecting"
    const hasDrift = runtime?.built_for && runtime.built_for !== server.config_version

    return (
        <section className="space-y-2">
            <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Runtime</h3>
                {isAdmin && (
                    <div className="flex items-center gap-1">
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={onRestart}
                            disabled={isBusy}
                            className="h-7 text-xs"
                            title="Disconnect and re-validate"
                        >
                            {isRestarting
                                ? <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                                : <RotateCw className="h-3 w-3 mr-1.5" />}
                            Restart
                        </Button>
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={onStop}
                            disabled={isBusy || status === "idle"}
                            className="h-7 text-xs"
                            title="Close the cached transport; next call rebuilds"
                        >
                            {isStopping
                                ? <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                                : <Power className="h-3 w-3 mr-1.5" />}
                            Stop
                        </Button>
                    </div>
                )}
            </div>

            <div className="rounded-md border p-3 text-sm space-y-2">
                <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs">
                    <dt className="text-muted-foreground">Status</dt>
                    <dd><RuntimeStatusBadge status={status} /></dd>

                    {isStdio && (
                        <>
                            <dt className="text-muted-foreground">PID</dt>
                            <dd className="font-mono">{runtime?.pid ?? "—"}</dd>
                        </>
                    )}

                    <dt className="text-muted-foreground">Started</dt>
                    <dd className="font-mono">
                        {runtime?.started_at
                            ? <>{formatToLocal(runtime.started_at)} <span className="text-muted-foreground">· {formatUptime(runtime.started_at)}</span></>
                            : "—"}
                    </dd>

                    {hasDrift && (
                        <>
                            <dt className="text-muted-foreground">Config</dt>
                            <dd className="text-amber-600 dark:text-amber-400">
                                Stale — next call rebuilds
                            </dd>
                        </>
                    )}
                </dl>

                {runtime?.error && status === "failed" && (
                    <pre className="font-mono text-[11px] leading-snug whitespace-pre-wrap break-words bg-destructive/10 text-destructive rounded p-2 max-h-32 overflow-auto">
                        {runtime.error}
                    </pre>
                )}

                {isLoading && !runtime && (
                    <div className="text-[11px] text-muted-foreground italic">Loading runtime status…</div>
                )}
            </div>

            <RuntimeLogPanel logs={runtime?.recent_logs ?? []} />
        </section>
    )
}

function RuntimeLogPanel({ logs }: { logs: string[] }) {
    const scrollRef = React.useRef<HTMLDivElement | null>(null)
    const [followTail, setFollowTail] = React.useState(true)

    React.useEffect(() => {
        if (!followTail) return
        const el = scrollRef.current
        if (el) el.scrollTop = el.scrollHeight
    }, [logs.length, followTail])

    return (
        <div className="rounded border border-border bg-muted/30">
            <div className="flex items-center justify-between border-b border-border px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                <span>Log file tail</span>
                <div className="flex items-center gap-2">
                    <span>{logs.length} line{logs.length === 1 ? "" : "s"}</span>
                    <label className="flex cursor-pointer items-center gap-1 normal-case tracking-normal">
                        <input
                            type="checkbox"
                            checked={followTail}
                            onChange={(e) => setFollowTail(e.target.checked)}
                            className="h-3 w-3"
                        />
                        Follow
                    </label>
                </div>
            </div>
            <div
                ref={scrollRef}
                className="max-h-64 overflow-auto scrollbar-thin px-2 py-1.5 font-mono text-[11px] leading-snug whitespace-pre-wrap break-words"
                onScroll={(e) => {
                    const t = e.currentTarget
                    // Disengage follow-mode as soon as the admin scrolls
                    // away from the bottom (e.g. to copy a stack trace).
                    // Re-engage when they scroll back to the bottom.
                    const atBottom = t.scrollHeight - t.scrollTop - t.clientHeight < 8
                    if (atBottom !== followTail) setFollowTail(atBottom)
                }}
            >
                {logs.length === 0 ? (
                    <span className="italic text-muted-foreground">No log file yet — the server hasn&apos;t been started.</span>
                ) : (
                    logs.map((line, i) => <div key={i}>{line}</div>)
                )}
            </div>
        </div>
    )
}

export function ServerInfoSection({ info }: { info: McpServerInfo }) {
    const hasIdentity = !!(info.name || info.version)
    const hasInstructions = !!info.instructions?.trim()
    const caps = info.capabilities ? Object.keys(info.capabilities) : []
    if (!hasIdentity && !hasInstructions && caps.length === 0) return null
    return (
        <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Server
            </h3>
            <div className="rounded-md border p-3 space-y-2 text-sm">
                {hasIdentity && (
                    <div className="font-mono text-xs">
                        {info.name ?? "<unnamed>"}
                        {info.version && <span className="text-muted-foreground"> @ {info.version}</span>}
                    </div>
                )}
                {caps.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                        {caps.map((cap) => (
                            <span
                                key={cap}
                                className="inline-flex items-center rounded border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
                                title={`Server advertises the "${cap}" capability`}
                            >
                                {cap}
                            </span>
                        ))}
                    </div>
                )}
                {hasInstructions && (
                    <div>
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                            Instructions
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">
                            {info.instructions}
                        </p>
                    </div>
                )}
            </div>
        </section>
    )
}

export function EndpointSection({ server, isAdmin }: { server: McpServerDTO; isAdmin: boolean }) {
    const c = server.config ?? {}
    return (
        <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {server.transport === "stdio" ? "Command" : "Endpoint"}
            </h3>
            <div className="rounded-md border p-3 space-y-2">
                {server.transport === "stdio" ? (
                    <>
                        <div className="font-mono text-xs break-all">
                            <span className="text-muted-foreground">$ </span>
                            {String(c.command ?? "")}{" "}
                            {Array.isArray(c.args) ? (c.args as string[]).join(" ") : ""}
                        </div>
                        {c.env && isAdmin && Object.keys(c.env as object).length > 0 && (
                            <div>
                                <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Env</div>
                                <ul className="font-mono text-[11px] space-y-0.5">
                                    {Object.entries(c.env as Record<string, string>).map(([k, v]) => (
                                        <li key={k} className="truncate">
                                            <span className="text-muted-foreground">{k}</span>={isSecretKey(k) ? "•••" : v}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </>
                ) : (
                    <>
                        <div className="font-mono text-xs break-all">{String(c.url ?? "")}</div>
                        {c.headers && isAdmin && Object.keys(c.headers as object).length > 0 && (
                            <div>
                                <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Headers</div>
                                <ul className="font-mono text-[11px] space-y-0.5">
                                    {Object.entries(c.headers as Record<string, string>).map(([k, v]) => (
                                        <li key={k} className="truncate">
                                            <span className="text-muted-foreground">{k}:</span> {isSecretKey(k) ? "•••" : v}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </>
                )}
            </div>
        </section>
    )
}

export function ToolsSection({
    tools,
    status,
}: {
    tools: McpToolDescriptor[]
    status: "ok" | "error" | null
}) {
    return (
        <section className="space-y-2">
            <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Tools {tools.length > 0 && <span className="ml-1 text-foreground">({tools.length})</span>}
                </h3>
            </div>
            {tools.length === 0 ? (
                <div className="rounded-md border p-3 text-xs text-muted-foreground italic">
                    {status === "error"
                        ? "No tools cached — last check failed."
                        : "No tools cached yet. Run a check to populate."}
                </div>
            ) : (
                <ul className="rounded-md border divide-y">
                    {tools.map((t) => (
                        <ToolRow key={t.name} tool={t} />
                    ))}
                </ul>
            )}
        </section>
    )
}

function ToolRow({ tool }: { tool: McpToolDescriptor }) {
    const [open, setOpen] = React.useState(false)
    const params = tool.parameters as { properties?: Record<string, unknown>; required?: string[] }
    const propEntries = params?.properties ? Object.entries(params.properties) : []
    const required = new Set(params?.required ?? [])
    return (
        <li className={cn("p-3 text-xs space-y-1.5", open && "bg-muted/30")}>
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className="flex w-full items-center gap-2 text-left"
            >
                <ExternalLink className="h-3 w-3 text-muted-foreground rotate-90" />
                <span className="font-mono text-foreground">{tool.name}</span>
                {propEntries.length > 0 && (
                    <span className="text-[10px] text-muted-foreground">{propEntries.length} param{propEntries.length === 1 ? "" : "s"}</span>
                )}
            </button>
            {tool.description && (
                <p className="text-muted-foreground pl-5 leading-snug">{tool.description}</p>
            )}
            {open && (
                <div className="pl-5 pt-1">
                    {propEntries.length === 0 ? (
                        <p className="text-muted-foreground italic">(no parameters)</p>
                    ) : (
                        <ul className="space-y-1">
                            {propEntries.map(([k, v]) => {
                                const meta = v as { type?: string; description?: string }
                                return (
                                    <li key={k} className="flex gap-2">
                                        <span className="font-mono text-foreground">{k}</span>
                                        {meta?.type && (
                                            <span className="font-mono text-muted-foreground text-[10px]">
                                                : {meta.type}
                                            </span>
                                        )}
                                        {required.has(k) && (
                                            <Badge variant="outline" className="h-3.5 px-1 text-[9px]">required</Badge>
                                        )}
                                        {meta?.description && (
                                            <span className="text-muted-foreground text-[11px] truncate">— {meta.description}</span>
                                        )}
                                    </li>
                                )
                            })}
                        </ul>
                    )}
                </div>
            )}
        </li>
    )
}

export function ResourcesSection({
    snapshot,
    capabilityAdvertised,
    status,
}: {
    snapshot: McpResourcesSnapshot | null
    capabilityAdvertised: boolean
    status: "ok" | "error" | null
}) {
    const total = snapshot ? snapshot.resources.length + snapshot.templates.length : 0
    return (
        <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Resources {total > 0 && <span className="ml-1 text-foreground">({total})</span>}
            </h3>
            {!capabilityAdvertised ? (
                <EmptyHint>This server does not advertise the <Tag>resources</Tag> capability.</EmptyHint>
            ) : snapshot === null ? (
                <EmptyHint>
                    {status === "error"
                        ? "Last check failed — run another to populate."
                        : "Server advertises resources but the list call did not complete."}
                </EmptyHint>
            ) : total === 0 ? (
                <EmptyHint>Server advertises resources but exposes none.</EmptyHint>
            ) : (
                <ul className="rounded-md border divide-y">
                    {snapshot.resources.map((r) => (
                        <li key={`r-${r.uri}`} className="p-3 text-xs space-y-0.5">
                            <div className="font-mono text-foreground break-all">{r.uri}</div>
                            <div className="flex items-baseline gap-2">
                                {r.name && <span className="text-foreground">{r.name}</span>}
                                {r.mimeType && (
                                    <span className="font-mono text-[10px] text-muted-foreground">{r.mimeType}</span>
                                )}
                            </div>
                            {r.description && (
                                <p className="text-muted-foreground leading-snug">{r.description}</p>
                            )}
                        </li>
                    ))}
                    {snapshot.templates.map((t) => (
                        <li key={`t-${t.uriTemplate}`} className="p-3 text-xs space-y-0.5 bg-muted/10">
                            <div className="flex items-baseline gap-2">
                                <span className="inline-flex items-center rounded border border-border bg-muted/40 px-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                                    template
                                </span>
                                <span className="font-mono text-foreground break-all">{t.uriTemplate}</span>
                            </div>
                            {(t.name || t.mimeType) && (
                                <div className="flex items-baseline gap-2 pl-[60px]">
                                    {t.name && <span className="text-foreground">{t.name}</span>}
                                    {t.mimeType && (
                                        <span className="font-mono text-[10px] text-muted-foreground">{t.mimeType}</span>
                                    )}
                                </div>
                            )}
                            {t.description && (
                                <p className="text-muted-foreground leading-snug pl-[60px]">{t.description}</p>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </section>
    )
}

export function PromptsSection({
    prompts,
    capabilityAdvertised,
    status,
}: {
    prompts: McpPromptDescriptor[] | null
    capabilityAdvertised: boolean
    status: "ok" | "error" | null
}) {
    return (
        <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Prompts {prompts && prompts.length > 0 && (
                    <span className="ml-1 text-foreground">({prompts.length})</span>
                )}
            </h3>
            {!capabilityAdvertised ? (
                <EmptyHint>This server does not advertise the <Tag>prompts</Tag> capability.</EmptyHint>
            ) : prompts === null ? (
                <EmptyHint>
                    {status === "error"
                        ? "Last check failed — run another to populate."
                        : "Server advertises prompts but the list call did not complete."}
                </EmptyHint>
            ) : prompts.length === 0 ? (
                <EmptyHint>Server advertises prompts but exposes none.</EmptyHint>
            ) : (
                <ul className="rounded-md border divide-y">
                    {prompts.map((p) => (
                        <PromptRow key={p.name} prompt={p} />
                    ))}
                </ul>
            )}
        </section>
    )
}

function PromptRow({ prompt }: { prompt: McpPromptDescriptor }) {
    const [open, setOpen] = React.useState(false)
    const args = prompt.arguments ?? []
    return (
        <li className={cn("p-3 text-xs space-y-1.5", open && "bg-muted/30")}>
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className="flex w-full items-center gap-2 text-left"
            >
                <ExternalLink className="h-3 w-3 text-muted-foreground rotate-90" />
                <span className="font-mono text-foreground">{prompt.name}</span>
                {args.length > 0 && (
                    <span className="text-[10px] text-muted-foreground">{args.length} arg{args.length === 1 ? "" : "s"}</span>
                )}
            </button>
            {prompt.description && (
                <p className="text-muted-foreground pl-5 leading-snug">{prompt.description}</p>
            )}
            {open && args.length > 0 && (
                <ul className="pl-5 pt-1 space-y-1">
                    {args.map((a) => (
                        <li key={a.name} className="flex gap-2">
                            <span className="font-mono text-foreground">{a.name}</span>
                            {a.required && (
                                <Badge variant="outline" className="h-3.5 px-1 text-[9px]">required</Badge>
                            )}
                            {a.description && (
                                <span className="text-muted-foreground text-[11px] truncate">— {a.description}</span>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </li>
    )
}
