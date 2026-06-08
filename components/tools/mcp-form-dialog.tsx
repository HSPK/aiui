"use client"

import * as React from "react"
import { toast } from "sonner"
import { Loader2, Sparkles } from "lucide-react"

import { mcpServers } from "@/lib/api"
import type { McpPreset, McpServerCreateInput, McpServerDTO } from "@/lib/schemas/mcp"

import {
    Dialog,
    DialogContent,
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

export function McpFormDialog({ open, onOpenChange, mode, server }: Props) {
    const [name, setName] = React.useState("")
    const [description, setDescription] = React.useState("")
    const [transport, setTransport] = React.useState<Transport>("stdio")
    const [stdio, setStdio] = React.useState<StdioFields>(DEFAULT_STDIO)
    const [http, setHttp] = React.useState<HttpFields>(DEFAULT_HTTP)
    const [enabled, setEnabled] = React.useState(true)
    const [error, setError] = React.useState<string | null>(null)
    const [presetId, setPresetId] = React.useState<string>("")

    // Only show the preset picker in create mode — editing an existing
    // row would clobber whatever the admin has already configured.
    const { data: presets } = mcpServers.usePresets()
    const showPresets = mode === "create" && !server

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
        setError(null)
        setPresetId("")
    }, [open, server])

    /** Hydrate the form from a preset. Wipes the prior config so the
     *  admin doesn't end up with a frankenstein merge. Slot values
     *  (`<UPPERCASE>` placeholders) are kept verbatim — the admin then
     *  edits them in the env / args textareas. */
    const applyPreset = React.useCallback((p: McpPreset) => {
        setName(p.name)
        setDescription(p.description ?? "")
        setTransport(p.transport)
        setEnabled(true)
        setError(null)
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
            toast.success("Saved")
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

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault()
        if (!name.trim()) return toast.error("Name required")

        let config: Record<string, unknown> = {}
        try {
            if (transport === "stdio") {
                if (!stdio.command.trim()) {
                    setError("command is required")
                    return
                }
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
                if (!http.url.trim()) {
                    setError("url is required")
                    return
                }
                const headers = http.headers.trim() ? JSON.parse(http.headers) : {}
                config = { url: http.url.trim(), headers }
            }
            setError(null)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Invalid JSON")
            return
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

    const isLoading = createMutation.isPending || updateMutation.isPending
    const title = mode === "create" ? "Add MCP server" : "Edit"

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="sm:max-w-[640px] max-h-[90vh] overflow-y-auto"
                onOpenAutoFocus={mode === "edit" ? (e) => e.preventDefault() : undefined}
            >
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4">
                    {showPresets && (presets ?? []).length > 0 && (
                        <div className="rounded-md border border-dashed bg-muted/30 p-2">
                            <div className="flex items-center gap-2">
                                <Sparkles className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                                <Label className="text-xs shrink-0">Import preset</Label>
                                <Select
                                    value={presetId}
                                    onValueChange={(id) => {
                                        setPresetId(id)
                                        const p = (presets ?? []).find((x) => x.id === id)
                                        if (p) applyPreset(p)
                                    }}
                                >
                                    <SelectTrigger className="h-8 text-xs flex-1">
                                        <SelectValue placeholder="Pick a well-known MCP server…" />
                                    </SelectTrigger>
                                    <SelectContent className="max-h-[360px]">
                                        {(presets ?? []).map((p) => (
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
                        </div>
                    )}

                    <Field label="Name" htmlFor="m-name">
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
                            className="h-9 text-sm"
                        />
                    </Field>

                    <Tabs value={transport} onValueChange={(v) => setTransport(v as Transport)}>
                        <TabsList className="grid w-full grid-cols-2">
                            <TabsTrigger value="stdio">stdio</TabsTrigger>
                            <TabsTrigger value="http">http</TabsTrigger>
                        </TabsList>

                        <TabsContent value="stdio" className="space-y-3 pt-3">
                            <Field label="Command" htmlFor="m-cmd">
                                <Input
                                    id="m-cmd"
                                    value={stdio.command}
                                    onChange={(e) => setStdio((s) => ({ ...s, command: e.target.value }))}
                                    placeholder="npx"
                                    className="h-9 text-sm font-mono"
                                />
                            </Field>
                            <Field label="Args (one per line)" htmlFor="m-args">
                                <Textarea
                                    id="m-args"
                                    value={stdio.args}
                                    onChange={(e) => setStdio((s) => ({ ...s, args: e.target.value }))}
                                    rows={3}
                                    placeholder={"-y\n@modelcontextprotocol/server-filesystem\n/path/to/dir"}
                                    className="text-xs font-mono"
                                />
                            </Field>
                            <Field label="Env (JSON)" htmlFor="m-env">
                                <Textarea
                                    id="m-env"
                                    value={stdio.env}
                                    onChange={(e) => setStdio((s) => ({ ...s, env: e.target.value }))}
                                    rows={3}
                                    className="text-xs font-mono"
                                />
                            </Field>
                            <Field label="cwd (optional)" htmlFor="m-cwd">
                                <Input
                                    id="m-cwd"
                                    value={stdio.cwd}
                                    onChange={(e) => setStdio((s) => ({ ...s, cwd: e.target.value }))}
                                    className="h-9 text-sm font-mono"
                                />
                            </Field>
                        </TabsContent>

                        <TabsContent value="http" className="space-y-3 pt-3">
                            <Field label="URL" htmlFor="m-url">
                                <Input
                                    id="m-url"
                                    value={http.url}
                                    onChange={(e) => setHttp((h) => ({ ...h, url: e.target.value }))}
                                    placeholder="https://example.com/mcp"
                                    className="h-9 text-sm font-mono"
                                />
                            </Field>
                            <Field label="Headers (JSON)" htmlFor="m-headers">
                                <Textarea
                                    id="m-headers"
                                    value={http.headers}
                                    onChange={(e) => setHttp((h) => ({ ...h, headers: e.target.value }))}
                                    rows={3}
                                    className="text-xs font-mono"
                                />
                            </Field>
                        </TabsContent>
                    </Tabs>

                    {error && <p className="text-xs text-destructive">{error}</p>}

                    <div className="flex items-center justify-between">
                        <Label htmlFor="m-enabled" className="text-xs">Enabled</Label>
                        <Switch id="m-enabled" checked={enabled} onCheckedChange={setEnabled} />
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-2">
                        <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={isLoading}>
                            Cancel
                        </Button>
                        <Button type="submit" size="sm" disabled={isLoading}>
                            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Save
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    )
}

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
    return (
        <div className="grid gap-1.5 min-w-0">
            <Label htmlFor={htmlFor} className="text-xs">{label}</Label>
            {children}
        </div>
    )
}
