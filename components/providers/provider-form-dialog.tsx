"use client"

import { adapters, providers } from "@/lib/api";
import type { ProviderCreateInput, ProviderDTO, ProviderUpdateInput } from "@/lib/schemas/provider";
import { useEffect, useState } from "react"

import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { toast } from "sonner"
import { Loader2, Eye, EyeOff, Activity } from "lucide-react"

interface Props {
    open: boolean
    onOpenChange: (open: boolean) => void
    mode: "create" | "edit"
    provider?: ProviderDTO | null
}

/** Sentinel for the "let the server auto-detect" dropdown option. Radix
 *  Select forbids empty-string item values, so we use a marker string and
 *  translate it to `undefined` on submit. */
const ADAPTER_AUTO = "__auto__"
/** Sentinel for "use the same adapter as transport" in the schema dropdown. */
const SCHEMA_INHERIT = "__inherit__"

export function ProviderFormDialog({ open, onOpenChange, mode, provider }: Props) {
    const { data: adapterList } = adapters.useList(undefined, { enabled: open })

    const [name, setName] = useState("")
    const [adapterId, setAdapterId] = useState<string>(ADAPTER_AUTO)
    const [schemaAdapterId, setSchemaAdapterId] = useState<string>(SCHEMA_INHERIT)
    const [baseUrl, setBaseUrl] = useState("")
    const [apiVersion, setApiVersion] = useState("")
    const [apiKey, setApiKey] = useState("")
    const [showKey, setShowKey] = useState(false)
    const [defaultParams, setDefaultParams] = useState("{}")
    const [documentPage, setDocumentPage] = useState("")
    const [modelPage, setModelPage] = useState("")
    const [healthCheckUrl, setHealthCheckUrl] = useState("")
    const [enabled, setEnabled] = useState(true)
    const [parseError, setParseError] = useState<string | null>(null)
    const [healthTesting, setHealthTesting] = useState(false)

    useEffect(() => {
        if (!open) return
        if (mode === "edit" && provider) {
            setName(provider.name)
            setAdapterId(provider.adapter_id ?? "openai")
            setSchemaAdapterId(provider.schema_adapter_id ?? SCHEMA_INHERIT)
            setBaseUrl(provider.base_url)
            setApiVersion(provider.api_version ?? "")
            setApiKey("")
            setDefaultParams(JSON.stringify(provider.default_params ?? {}, null, 2))
            setDocumentPage(provider.document_page ?? "")
            setModelPage(provider.model_page ?? "")
            setHealthCheckUrl(provider.health_check_url ?? "")
            setEnabled(provider.enabled)
        } else {
            setName("")
            setAdapterId(ADAPTER_AUTO)
            setSchemaAdapterId(SCHEMA_INHERIT)
            setBaseUrl("")
            setApiVersion("")
            setApiKey("")
            setDefaultParams("{}")
            setDocumentPage("")
            setModelPage("")
            setHealthCheckUrl("")
            setEnabled(true)
        }
        setShowKey(false)
        setParseError(null)
    }, [open, mode, provider])

    const createMutation = providers.useCreate({
        onSuccess: () => {
            toast.success("Provider created")
            onOpenChange(false)
        },
        onError: (e) => toast.error(e.message || "Create failed"),
    })

    const updateMutation = providers.useUpdate({
        onSuccess: () => {
            toast.success("Provider updated")
            onOpenChange(false)
        },
        onError: (e) => toast.error(e.message || "Update failed"),
    })

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault()
        if (!name.trim()) return toast.error("Name required")
        if (!baseUrl.trim()) return toast.error("base_url required")

        let params: Record<string, unknown> = {}
        try {
            params = defaultParams.trim() ? JSON.parse(defaultParams) : {}
            setParseError(null)
        } catch (err) {
            const msg = err instanceof Error ? err.message : "Invalid JSON"
            setParseError(msg)
            return
        }

        const payload: ProviderCreateInput = {
            name: name.trim(),
            adapter_id: adapterId === ADAPTER_AUTO ? undefined : adapterId,
            schema_adapter_id: schemaAdapterId === SCHEMA_INHERIT ? null : schemaAdapterId,
            base_url: baseUrl.trim(),
            api_version: apiVersion.trim() || null,
            default_params: params,
            document_page: documentPage || undefined,
            model_page: modelPage || undefined,
            health_check_url: healthCheckUrl.trim() || null,
            enabled,
        }
        if (apiKey) payload.api_key = apiKey

        if (mode === "create") {
            createMutation.mutate(payload)
        } else if (provider) {
            const data: ProviderUpdateInput = { ...payload }
            if (!apiKey) delete data.api_key  // don't overwrite stored key with empty
            updateMutation.mutate({ id: provider.id, data })
        }
    }

    /** Probe the health URL inline. Only works in edit mode for an existing
     *  provider — we ask the server to call its configured URL so any
     *  CORS/private-network rules behave the same as in production. */
    const handleHealthTest = async () => {
        if (!provider) {
            toast.message("Save the provider first to run the live health check.")
            return
        }
        setHealthTesting(true)
        try {
            const res = await providers.check(provider.id)
            if (res.ok) toast.success(`Healthy${res.latency_ms != null ? ` (${res.latency_ms}ms)` : ""}`)
            else toast.error(`Down: ${res.error ?? "unknown"}`)
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Health check failed")
        } finally {
            setHealthTesting(false)
        }
    }

    const isLoading = createMutation.isPending || updateMutation.isPending
    const isAzure = adapterId === "azure-openai" || adapterId === "azure-foundry"

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[640px] max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{mode === "create" ? "Add Provider" : "Edit Provider"}</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit}>
                    <div className="grid gap-4 py-4">
                        <div className="grid sm:grid-cols-[1fr_220px] gap-3">
                            <div className="grid gap-2 min-w-0">
                                <Label htmlFor="p-name" className="text-xs">Name</Label>
                                <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="openai" className="h-9 text-sm" />
                            </div>
                            <div className="grid gap-2 min-w-0">
                                <Label className="text-xs">Adapter</Label>
                                <Select value={adapterId} onValueChange={setAdapterId}>
                                    <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Auto-detect" /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value={ADAPTER_AUTO}>Auto-detect</SelectItem>
                                        {(adapterList ?? []).map((a) => (
                                            <SelectItem key={a.id} value={a.id}>
                                                {a.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="p-url" className="text-xs">Base URL</Label>
                            <Input
                                id="p-url"
                                value={baseUrl}
                                onChange={(e) => setBaseUrl(e.target.value)}
                                placeholder={isAzure ? "https://my-resource.openai.azure.com" : "https://api.openai.com/v1"}
                                className="h-9 text-sm font-mono"
                            />
                        </div>
                        {isAzure && (
                            <div className="grid gap-2">
                                <Label htmlFor="p-apiversion" className="text-xs">API Version</Label>
                                <Input
                                    id="p-apiversion"
                                    value={apiVersion}
                                    onChange={(e) => setApiVersion(e.target.value)}
                                    placeholder="2024-10-21"
                                    className="h-9 text-sm font-mono"
                                />
                            </div>
                        )}
                        <div className="grid gap-2">
                            <Label htmlFor="p-key" className="text-xs">API Key</Label>
                            {/* In edit mode show the existing masked key as a separate
                                read-only chip so the input itself always carries the
                                same plain placeholder — avoids the password-glyph /
                                placeholder-glyph overlap that long mono masks caused. */}
                            {mode === "edit" && provider?.api_key_mask && (
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <span>Current</span>
                                    <code className="font-mono bg-muted/60 px-1.5 py-0.5 rounded text-foreground">{provider.api_key_mask}</code>
                                    <span className="opacity-75">— leave field blank to keep</span>
                                </div>
                            )}
                            <div className="relative">
                                <Input
                                    id="p-key"
                                    type={showKey ? "text" : "password"}
                                    value={apiKey}
                                    onChange={(e) => setApiKey(e.target.value)}
                                    placeholder={mode === "edit" ? "Enter a new key to replace" : "sk-..."}
                                    className="h-9 text-sm pr-10 font-mono"
                                    autoComplete="off"
                                />
                                <Button type="button" variant="ghost" size="icon" onClick={() => setShowKey(!showKey)} className="absolute right-0 top-0 h-9 w-9 text-muted-foreground">
                                    {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                </Button>
                            </div>
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="p-health" className="text-xs">Health check URL</Label>
                            <div className="flex gap-2">
                                <Input
                                    id="p-health"
                                    value={healthCheckUrl}
                                    onChange={(e) => setHealthCheckUrl(e.target.value)}
                                    placeholder='Optional — must return {"status":"ok"}'
                                    className="h-9 text-sm font-mono flex-1 min-w-0"
                                />
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="h-9 shrink-0"
                                    onClick={handleHealthTest}
                                    disabled={!healthCheckUrl.trim() || healthTesting || mode === "create"}
                                    title={mode === "create" ? "Save first, then test" : "Run the health probe now"}
                                >
                                    {healthTesting
                                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        : <Activity className="h-3.5 w-3.5" />}
                                    <span className="ml-1">Test</span>
                                </Button>
                            </div>
                        </div>
                        <div className="grid sm:grid-cols-2 gap-3">
                            <div className="grid gap-2 min-w-0">
                                <Label className="text-xs">Schema adapter override</Label>
                                <Select value={schemaAdapterId} onValueChange={setSchemaAdapterId}>
                                    <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value={SCHEMA_INHERIT}>Inherit from adapter</SelectItem>
                                        {(adapterList ?? []).map((a) => (
                                            <SelectItem key={a.id} value={a.id}>{a.label}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="grid gap-2 min-w-0">
                                <Label htmlFor="p-doc" className="text-xs">Docs URL</Label>
                                <Input id="p-doc" value={documentPage} onChange={(e) => setDocumentPage(e.target.value)} className="h-9 text-sm" />
                            </div>
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="p-models" className="text-xs">Models page URL</Label>
                            <Input id="p-models" value={modelPage} onChange={(e) => setModelPage(e.target.value)} className="h-9 text-sm" />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="p-params" className="text-xs">Default params (JSON)</Label>
                            <Textarea
                                id="p-params"
                                value={defaultParams}
                                onChange={(e) => setDefaultParams(e.target.value)}
                                rows={4}
                                className="text-xs font-mono"
                            />
                            {parseError && <span className="text-xs text-destructive">{parseError}</span>}
                        </div>
                        <div className="flex items-center justify-between">
                            <Label htmlFor="p-enabled" className="text-xs">Enabled</Label>
                            <Switch id="p-enabled" checked={enabled} onCheckedChange={setEnabled} />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={isLoading}>Cancel</Button>
                        <Button type="submit" size="sm" disabled={isLoading}>
                            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {mode === "create" ? "Create" : "Save"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}
