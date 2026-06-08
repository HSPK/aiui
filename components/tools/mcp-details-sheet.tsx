"use client"

import * as React from "react"
import { toast } from "sonner"
import { CheckCircle2, ExternalLink, Loader2, RefreshCcw, Wrench, XCircle } from "lucide-react"

import { mcpServers } from "@/lib/api"
import type { McpServerDTO, McpServerInfo, McpPromptDescriptor, McpResourcesSnapshot, McpToolDescriptor } from "@/lib/schemas/mcp"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { cn, formatToLocal } from "@/lib/utils"

interface Props {
    server: McpServerDTO | null
    open: boolean
    onOpenChange: (open: boolean) => void
    isAdmin: boolean
}

/**
 * Read-only details panel for one MCP server. Shows connection
 * status, last-known tool list (with parameter schema), full config
 * (admin only — config can carry secrets), and a "Re-check" button.
 */
export function McpServerDetailsSheet({ server, open, onOpenChange, isAdmin }: Props) {
    const check = mcpServers.useCheck({
        onSuccess: (s) => {
            toast.success(
                s.last_check_status === "ok"
                    ? `Check passed — ${s.tools_cache?.length ?? 0} tools`
                    : `Check failed: ${s.last_check_error ?? "unknown error"}`,
            )
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
                    <ResourcesSection snapshot={server.resources_cache} />
                    <PromptsSection prompts={server.prompts_cache} />
                </div>
            </SheetContent>
        </Sheet>
    )
}

function HealthSection({
    server,
    onCheck,
    isChecking,
    isAdmin,
}: {
    server: McpServerDTO
    onCheck: () => void
    isChecking: boolean
    isAdmin: boolean
}) {    const status = server.last_check_status
    const checkedAt = server.last_check_at ? formatToLocal(server.last_check_at) : "never"
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
                    <StatusDot status={status} />
                    <span className="font-medium">
                        {status === "ok" && "Connected"}
                        {status === "error" && "Failed"}
                        {status === null && "Never checked"}
                    </span>
                </div>
                <div className="text-[11px] text-muted-foreground">Last check: {checkedAt}</div>
                {status === "error" && server.last_check_error && (
                    <pre className="mt-1.5 font-mono text-[11px] leading-tight whitespace-pre-wrap break-all bg-destructive/10 text-destructive rounded p-2 max-h-40 overflow-auto">
                        {server.last_check_error}
                    </pre>
                )}
            </div>
        </section>
    )
}

function StatusDot({ status }: { status: "ok" | "error" | null }) {
    if (status === "ok") return <CheckCircle2 className="h-4 w-4 text-emerald-500" />
    if (status === "error") return <XCircle className="h-4 w-4 text-destructive" />
    return <Loader2 className="h-4 w-4 text-muted-foreground animate-spin" />
}

function ServerInfoSection({ info }: { info: McpServerInfo }) {
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

function EndpointSection({ server, isAdmin }: { server: McpServerDTO; isAdmin: boolean }) {
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

function isSecretKey(k: string): boolean {
    return /token|secret|key|password|auth/i.test(k)
}

function ToolsSection({
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

function ResourcesSection({ snapshot }: { snapshot: McpResourcesSnapshot | null }) {
    if (!snapshot) {
        // Server didn't advertise the resources capability — hide the
        // section entirely so we don't confuse admins with an empty
        // block for a feature this server doesn't support.
        return null
    }
    const { resources, templates } = snapshot
    const total = resources.length + templates.length
    return (
        <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Resources {total > 0 && <span className="ml-1 text-foreground">({total})</span>}
            </h3>
            {total === 0 ? (
                <div className="rounded-md border p-3 text-xs text-muted-foreground italic">
                    Server advertises `resources` but exposes none.
                </div>
            ) : (
                <ul className="rounded-md border divide-y">
                    {resources.map((r) => (
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
                    {templates.map((t) => (
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

function PromptsSection({ prompts }: { prompts: McpPromptDescriptor[] | null }) {
    if (!prompts) return null
    return (
        <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Prompts {prompts.length > 0 && <span className="ml-1 text-foreground">({prompts.length})</span>}
            </h3>
            {prompts.length === 0 ? (
                <div className="rounded-md border p-3 text-xs text-muted-foreground italic">
                    Server advertises `prompts` but exposes none.
                </div>
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
