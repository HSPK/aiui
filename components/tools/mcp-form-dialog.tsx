"use client"

import * as React from "react"
import { toast } from "sonner"
import { AlertCircle, CheckCircle2, Loader2, Sparkles } from "lucide-react"

import { mcpServers } from "@/lib/api"
import type { McpPreset, McpServerCreateInput, McpServerDTO } from "@/lib/schemas/mcp"

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import {
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
} from "@/components/ui/tabs"
import { cn } from "@/lib/utils"

interface Props {
    open: boolean
    onOpenChange: (open: boolean) => void
    mode: "create" | "edit"
    server?: McpServerDTO | null
}

type Transport = "stdio" | "http"

interface StdioFields {
    command: string
    args: string
    env: string
    cwd: string
}

interface HttpFields {
    url: string
    headers: string
}

const DEFAULT_STDIO: StdioFields = { command: "", args: "", env: "{}", cwd: "" }
const DEFAULT_HTTP: HttpFields = { url: "", headers: "{}" }

function parseStdioConfig(cfg: Record<string, unknown>): StdioFields {
    const command = typeof cfg.command === "string" ? cfg.command : ""
    const args = Array.isArray(cfg.args) ? cfg.args.join("\n") : ""
    const env = cfg.env && typeof cfg.env === "object" ? JSON.stringify(cfg.env, null, 2) : "{}"
    const cwd = typeof cfg.cwd === "string" ? cfg.cwd : ""
    return { command, args, env, cwd }
}

function parseHttpConfig(cfg: Record<string, unknown>): HttpFields {
    const url = typeof cfg.url === "string" ? cfg.url : ""
    const headers = cfg.headers && typeof cfg.headers === "object" ? JSON.stringify(cfg.headers, null, 2) : "{}"
    return { url, headers }
}

/** Live JSON validity — `null` means valid (or empty); a string means
 *  the parse error to surface inline under the textarea. */
function jsonError(value: string): string | null {
    const trimmed = value.trim()
    if (!trimmed) return null
    try {
        const parsed = JSON.parse(trimmed)
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
            return "Must be a JSON object"
        }
        return null
    } catch (e) {
        return e instanceof Error ? e.message : "Invalid JSON"
    }
}

/** Scan a preset's slots and collect their human-readable labels so
 *  the form can show a "fill in:" reminder right under the import row. */
function presetSlotHints(p: McpPreset | undefined): string[] {
    if (!p?.slots?.length) return []
    return p.slots.map((s) => s.label)
}

export function McpFormDialog({ open, onOpenChange, mode, server }: Props) {
    const [name, setName] = React.useState("")
    const [description, setDescription] = React.useState("")
    const [transport, setTransport] = React.useState<Transport>("stdio")
    const [stdio, setStdio] = React.useState<StdioFields>(DEFAULT_STDIO)
    const [http, setHttp] = React.useState<HttpFields>(DEFAULT_HTTP)
    const [enabled, setEnabled] = React.useState(true)
    const [presetId, setPresetId] = React.useState<string>("")

    // Only show the preset picker in create mode — editing an existing
    // row would clobber whatever the admin has already configured.
    const { data: presets } = mcpServers.usePresets()
    const showPresets = mode === "create" && !server
    const activePreset = React.useMemo(
        () => (presets ?? []).find((p) => p.id === presetId),
        [presets, presetId],
    )

    React.useEffect(() => {
        if (!open) return
        if (server) {
            setName(server.name)
            setDescription(server.description ?? "")
            setTransport(server.transport)
            setEnabled(server.enabled !== false)
            if (server.transport === "stdio") {
                setStdio(parseStdioConfig(server.config ?? {}))
                setHttp(DEFAULT_HTTP)
            } else {
                setHttp(parseHttpConfig(server.config ?? {}))
                setStdio(DEFAULT_STDIO)
            }
        } else {
            setName("")
            setDescription("")
            setTransport("stdio")
            setStdio(DEFAULT_STDIO)
            setHttp(DEFAULT_HTTP)
            setEnabled(true)
        }
        setPresetId("")
    }, [open, server])

    const applyPreset = React.useCallback((p: McpPreset) => {
        setName(p.name)
        setDescription(p.description ?? "")
        setTransport(p.transport)
        setEnabled(true)
        if (p.transport === "stdio") {
            setStdio(parseStdioConfig(p.config ?? {}))
            setHttp(DEFAULT_HTTP)
        } else {
            setHttp(parseHttpConfig(p.config ?? {}))
            setStdio(DEFAULT_STDIO)
        }
    }, [])

    const createMutation = mcpServers.useCreate({
        onSuccess: () => {
            toast.success("Saved — testing connection…")
            onOpenChange(false)
        },
        onError: (e) => toast.error(e.message || "Save failed"),
    })
    const updateMutation = mcpServers.useUpdate({
        onSuccess: () => {
            toast.success("Saved")
            onOpenChange(false)
        },
        onError: (e) => toast.error(e.message || "Save failed"),
    })

    // Live validation — computed each render rather than on submit so
    // the Save button reflects the form state without re-clicking.
    const envError = transport === "stdio" ? jsonError(stdio.env) : null
    const headersError = transport === "http" ? jsonError(http.headers) : null
    const nameError = !name.trim() ? "Name is required" : null
    const targetError = transport === "stdio"
        ? (!stdio.command.trim() ? "Command is required" : null)
        : (!http.url.trim() ? "URL is required" : null)
    const formError = nameError ?? targetError ?? envError ?? headersError
    const isLoading = createMutation.isPending || updateMutation.isPending
    const canSubmit = !formError && !isLoading

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault()
        if (!canSubmit) return

        let config: Record<string, unknown> = {}
        if (transport === "stdio") {
            const argsArr = stdio.args
                .split("\n")
                .map((s) => s.trim())
                .filter(Boolean)
            const env = stdio.env.trim() ? JSON.parse(stdio.env) : {}
            config = {
                command: stdio.command.trim(),
                args: argsArr,
                env,
                ...(stdio.cwd.trim() ? { cwd: stdio.cwd.trim() } : {}),
            }
        } else {
            const headers = http.headers.trim() ? JSON.parse(http.headers) : {}
            config = { url: http.url.trim(), headers }
        }

        const payload: McpServerCreateInput = {
            name: name.trim(),
            description: description.trim(),
            transport,
            config,
            enabled,
        }

        if (mode === "create") createMutation.mutate(payload)
        else if (server) updateMutation.mutate({ id: server.id, data: payload })
    }

    const title = mode === "create" ? "Add MCP server" : `Edit ${server?.name ?? "server"}`
    const description_ = mode === "create"
        ? "Register a Model Context Protocol server. The connection is tested automatically after save — the result appears as a status pill on the table."
        : "Update an MCP server. Saving with a changed config triggers a re-check."

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="sm:max-w-[640px] max-h-[90vh] overflow-y-auto p-0"
                onOpenAutoFocus={mode === "edit" ? (e) => e.preventDefault() : undefined}
            >
                <DialogHeader className="px-6 pt-6 pb-4 border-b">
                    <DialogTitle className="text-base">{title}</DialogTitle>
                    <DialogDescription className="text-xs text-muted-foreground">
                        {description_}
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={handleSubmit}>
                    <div className="px-6 py-5 space-y-5">
                        {showPresets && (presets ?? []).length > 0 && (
                            <PresetPicker
                                presets={presets ?? []}
                                value={presetId}
                                onChange={(id) => {
                                    setPresetId(id)
                                    const p = (presets ?? []).find((x) => x.id === id)
                                    if (p) applyPreset(p)
                                }}
                                hints={presetSlotHints(activePreset)}
                            />
                        )}

                        <Section label="Identity">
                            <div className="grid grid-cols-1 sm:grid-cols-[200px_1fr] gap-3">
                                <Field label="Name" htmlFor="m-name" required>
                                    <Input
                                        id="m-name"
                                        value={name}
                                        onChange={(e) => setName(e.target.value)}
                                        placeholder="filesystem"
                                        className="h-9 text-sm font-mono"
                                    />
                                </Field>
                                <Field label="Description" htmlFor="m-desc">
                                    <Input
                                        id="m-desc"
                                        value={description}
                                        onChange={(e) => setDescription(e.target.value)}
                                        placeholder="(optional)"
                                        className="h-9 text-sm"
                                    />
                                </Field>
                            </div>
                        </Section>

                        <Section label="Transport">
                            <Tabs value={transport} onValueChange={(v) => setTransport(v as Transport)}>
                                <TabsList className="grid w-full grid-cols-2 h-9">
                                    <TabsTrigger value="stdio" className="text-xs">stdio (local process)</TabsTrigger>
                                    <TabsTrigger value="http" className="text-xs">http (remote)</TabsTrigger>
                                </TabsList>

                                <TabsContent value="stdio" className="space-y-3 pt-4">
                                    <Field label="Command" htmlFor="m-cmd" required>
                                        <Input
                                            id="m-cmd"
                                            value={stdio.command}
                                            onChange={(e) => setStdio((s) => ({ ...s, command: e.target.value }))}
                                            placeholder="npx"
                                            className="h-9 text-sm font-mono"
                                        />
                                    </Field>
                                    <Field label="Args" htmlFor="m-args" help="One per line">
                                        <Textarea
                                            id="m-args"
                                            value={stdio.args}
                                            onChange={(e) => setStdio((s) => ({ ...s, args: e.target.value }))}
                                            rows={4}
                                            placeholder={"-y\n@modelcontextprotocol/server-filesystem\n/path/to/dir"}
                                            className="text-xs font-mono leading-relaxed"
                                        />
                                    </Field>
                                    <Field
                                        label="Environment variables"
                                        htmlFor="m-env"
                                        help="JSON object — secret values are encrypted at rest"
                                        error={envError}
                                    >
                                        <Textarea
                                            id="m-env"
                                            value={stdio.env}
                                            onChange={(e) => setStdio((s) => ({ ...s, env: e.target.value }))}
                                            rows={4}
                                            className={cn(
                                                "text-xs font-mono leading-relaxed",
                                                envError && "border-destructive focus-visible:ring-destructive/40",
                                            )}
                                            spellCheck={false}
                                        />
                                    </Field>
                                    <Field label="Working directory" htmlFor="m-cwd" help="Optional">
                                        <Input
                                            id="m-cwd"
                                            value={stdio.cwd}
                                            onChange={(e) => setStdio((s) => ({ ...s, cwd: e.target.value }))}
                                            placeholder="/var/lib/mcp/data"
                                            className="h-9 text-sm font-mono"
                                        />
                                    </Field>
                                </TabsContent>

                                <TabsContent value="http" className="space-y-3 pt-4">
                                    <Field label="URL" htmlFor="m-url" required>
                                        <Input
                                            id="m-url"
                                            value={http.url}
                                            onChange={(e) => setHttp((h) => ({ ...h, url: e.target.value }))}
                                            placeholder="https://example.com/mcp"
                                            className="h-9 text-sm font-mono"
                                        />
                                    </Field>
                                    <Field
                                        label="Headers"
                                        htmlFor="m-headers"
                                        help="JSON object — secret values are encrypted at rest"
                                        error={headersError}
                                    >
                                        <Textarea
                                            id="m-headers"
                                            value={http.headers}
                                            onChange={(e) => setHttp((h) => ({ ...h, headers: e.target.value }))}
                                            rows={4}
                                            className={cn(
                                                "text-xs font-mono leading-relaxed",
                                                headersError && "border-destructive focus-visible:ring-destructive/40",
                                            )}
                                            placeholder={'{\n  "Authorization": "Bearer ..."\n}'}
                                            spellCheck={false}
                                        />
                                    </Field>
                                </TabsContent>
                            </Tabs>
                        </Section>
                    </div>

                    <DialogFooter className="px-6 py-4 border-t bg-muted/20 flex-row items-center !justify-between">
                        <label htmlFor="m-enabled" className="flex items-center gap-2 cursor-pointer">
                            <Switch id="m-enabled" checked={enabled} onCheckedChange={setEnabled} />
                            <span className="text-xs text-muted-foreground">
                                Enabled — available to chat tool aggregation
                            </span>
                        </label>
                        <div className="flex items-center gap-2">
                            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={isLoading}>
                                Cancel
                            </Button>
                            <Button type="submit" size="sm" disabled={!canSubmit} title={formError ?? undefined}>
                                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                {mode === "create" ? "Add server" : "Save changes"}
                            </Button>
                        </div>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}

// ---- Building blocks ----

function PresetPicker({
    presets,
    value,
    onChange,
    hints,
}: {
    presets: McpPreset[]
    value: string
    onChange: (id: string) => void
    hints: string[]
}) {
    return (
        <div className="rounded-lg border border-dashed border-amber-500/30 bg-amber-500/[0.04] p-3 space-y-2">
            <div className="flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                <Label className="text-xs font-medium shrink-0">Import a preset</Label>
                <Select value={value} onValueChange={onChange}>
                    <SelectTrigger className="h-8 text-xs flex-1">
                        <SelectValue placeholder="Pick a known-working MCP server…" />
                    </SelectTrigger>
                    <SelectContent className="max-h-[360px]">
                        {presets.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                                <div className="flex items-baseline gap-2">
                                    <span className="font-mono text-xs">{p.name}</span>
                                    <span className="text-[10px] text-muted-foreground truncate">
                                        {p.description}
                                    </span>
                                </div>
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
            {hints.length > 0 && (
                <div className="flex items-start gap-2 pl-5 text-[11px] text-amber-700 dark:text-amber-300">
                    <CheckCircle2 className="h-3 w-3 mt-0.5 shrink-0" />
                    <div>
                        <span className="font-medium">Fill in:</span>{" "}
                        {hints.join(", ")}
                    </div>
                </div>
            )}
        </div>
    )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <section className="space-y-3">
            <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                {label}
            </div>
            {children}
        </section>
    )
}

function Field({
    label,
    htmlFor,
    children,
    required,
    help,
    error,
}: {
    label: string
    htmlFor?: string
    children: React.ReactNode
    required?: boolean
    help?: string
    error?: string | null
}) {
    return (
        <div className="grid gap-1.5 min-w-0">
            <div className="flex items-baseline gap-2">
                <Label htmlFor={htmlFor} className="text-xs">
                    {label}
                    {required && <span className="text-destructive ml-0.5">*</span>}
                </Label>
                {help && !error && (
                    <span className="text-[10px] text-muted-foreground">— {help}</span>
                )}
            </div>
            {children}
            {error && (
                <div className="flex items-start gap-1 text-[11px] text-destructive">
                    <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
                    <span className="font-mono break-all">{error}</span>
                </div>
            )}
        </div>
    )
}
