"use client"

import * as React from "react"
import { toast } from "sonner"
import { AlertCircle, Loader2 } from "lucide-react"

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

export function McpFormDialog({ open, onOpenChange, mode, server }: Props) {
    const [name, setName] = React.useState("")
    const [description, setDescription] = React.useState("")
    const [transport, setTransport] = React.useState<Transport>("stdio")
    const [stdio, setStdio] = React.useState<StdioFields>(DEFAULT_STDIO)
    const [http, setHttp] = React.useState<HttpFields>(DEFAULT_HTTP)
    const [enabled, setEnabled] = React.useState(true)
    const [presetId, setPresetId] = React.useState<string>("")

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
        onSuccess: () => { toast.success("Saved"); onOpenChange(false) },
        onError: (e) => toast.error(e.message || "Save failed"),
    })
    const updateMutation = mcpServers.useUpdate({
        onSuccess: () => { toast.success("Saved"); onOpenChange(false) },
        onError: (e) => toast.error(e.message || "Save failed"),
    })

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
            const argsArr = stdio.args.split("\n").map((s) => s.trim()).filter(Boolean)
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

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto"
                onOpenAutoFocus={mode === "edit" ? (e) => e.preventDefault() : undefined}
            >
                <DialogHeader>
                    <DialogTitle className="text-base">{title}</DialogTitle>
                    {/* Visually hidden — satisfies radix's a11y contract
                        without adding filler copy to the dialog. */}
                    <DialogDescription className="sr-only">
                        Configure an MCP server.
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="space-y-4">
                    {showPresets && (presets ?? []).length > 0 && (
                        <Select
                            value={presetId}
                            onValueChange={(id) => {
                                setPresetId(id)
                                const p = (presets ?? []).find((x) => x.id === id)
                                if (p) applyPreset(p)
                            }}
                        >
                            <SelectTrigger className="h-9 text-xs">
                                <SelectValue placeholder="Import preset…" />
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
                    )}

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
                            className="h-9 text-sm"
                        />
                    </Field>

                    <Tabs value={transport} onValueChange={(v) => setTransport(v as Transport)}>
                        <TabsList className="grid w-full grid-cols-2 h-9">
                            <TabsTrigger value="stdio" className="text-xs">stdio</TabsTrigger>
                            <TabsTrigger value="http" className="text-xs">http</TabsTrigger>
                        </TabsList>

                        <TabsContent value="stdio" className="space-y-3 pt-3">
                            <Field label="Command" htmlFor="m-cmd" required>
                                <Input
                                    id="m-cmd"
                                    value={stdio.command}
                                    onChange={(e) => setStdio((s) => ({ ...s, command: e.target.value }))}
                                    placeholder="npx"
                                    className="h-9 text-sm font-mono"
                                />
                            </Field>
                            <Field label="Args" htmlFor="m-args">
                                <Textarea
                                    id="m-args"
                                    value={stdio.args}
                                    onChange={(e) => setStdio((s) => ({ ...s, args: e.target.value }))}
                                    rows={3}
                                    placeholder={"-y\n@modelcontextprotocol/server-filesystem\n/path/to/dir"}
                                    className="text-xs font-mono leading-relaxed"
                                />
                            </Field>
                            <Field label="Env" htmlFor="m-env" error={envError}>
                                <Textarea
                                    id="m-env"
                                    value={stdio.env}
                                    onChange={(e) => setStdio((s) => ({ ...s, env: e.target.value }))}
                                    rows={3}
                                    className={cn(
                                        "text-xs font-mono leading-relaxed",
                                        envError && "border-destructive focus-visible:ring-destructive/40",
                                    )}
                                    spellCheck={false}
                                />
                            </Field>
                            <Field label="cwd" htmlFor="m-cwd">
                                <Input
                                    id="m-cwd"
                                    value={stdio.cwd}
                                    onChange={(e) => setStdio((s) => ({ ...s, cwd: e.target.value }))}
                                    className="h-9 text-sm font-mono"
                                />
                            </Field>
                        </TabsContent>

                        <TabsContent value="http" className="space-y-3 pt-3">
                            <Field label="URL" htmlFor="m-url" required>
                                <Input
                                    id="m-url"
                                    value={http.url}
                                    onChange={(e) => setHttp((h) => ({ ...h, url: e.target.value }))}
                                    placeholder="https://example.com/mcp"
                                    className="h-9 text-sm font-mono"
                                />
                            </Field>
                            <Field label="Headers" htmlFor="m-headers" error={headersError}>
                                <Textarea
                                    id="m-headers"
                                    value={http.headers}
                                    onChange={(e) => setHttp((h) => ({ ...h, headers: e.target.value }))}
                                    rows={3}
                                    className={cn(
                                        "text-xs font-mono leading-relaxed",
                                        headersError && "border-destructive focus-visible:ring-destructive/40",
                                    )}
                                    spellCheck={false}
                                />
                            </Field>
                        </TabsContent>
                    </Tabs>
                </form>

                <DialogFooter className="flex-row items-center !justify-between">
                    <label htmlFor="m-enabled" className="flex items-center gap-2 cursor-pointer text-xs">
                        <Switch id="m-enabled" checked={enabled} onCheckedChange={setEnabled} />
                        Enabled
                    </label>
                    <div className="flex items-center gap-2">
                        <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={isLoading}>
                            Cancel
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            onClick={handleSubmit}
                            disabled={!canSubmit}
                            title={formError ?? undefined}
                        >
                            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Save
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

function Field({
    label,
    htmlFor,
    children,
    required,
    error,
}: {
    label: string
    htmlFor?: string
    children: React.ReactNode
    required?: boolean
    error?: string | null
}) {
    return (
        <div className="grid gap-1.5 min-w-0">
            <Label htmlFor={htmlFor} className="text-xs">
                {label}
                {required && <span className="text-destructive ml-0.5">*</span>}
            </Label>
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
