"use client"

import { capabilities, models, providers, adapters } from "@/lib/api";
import type { ModelCreateInput, ModelDTO } from "@/lib/schemas/model";
import { useEffect, useMemo, useState } from "react"

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
import { Loader2, Sparkles } from "lucide-react"

interface Props {
    open: boolean
    onOpenChange: (open: boolean) => void
    mode: "create" | "edit"
    model?: ModelDTO | null
    defaultProviderId?: string
}

/** "Inherit from provider" sentinel for the schema-adapter dropdown.
 *  Radix Select forbids empty-string item values. */
const SCHEMA_ADAPTER_INHERIT = "__inherit__"

export function ModelFormDialog({ open, onOpenChange, mode, model, defaultProviderId }: Props) {
    const { data: providerList } = providers.useList(undefined, { enabled: open })
    const { data: capabilityList } = capabilities.useList(undefined, { enabled: open })
    const { data: adapterList } = adapters.useList(undefined, { enabled: open })

    const [name, setName] = useState("")
    const [providerId, setProviderId] = useState<string>("")
    const [upstreamModelId, setUpstreamModelId] = useState("")
    const [type, setType] = useState<string>("chat")
    const [contextWindow, setContextWindow] = useState("")
    const [maxTokens, setMaxTokens] = useState("")
    const [outputDim, setOutputDim] = useState("")
    const [description, setDescription] = useState("")
    const [defaultParams, setDefaultParams] = useState("{}")
    const [enabled, setEnabled] = useState(true)
    const [schemaAdapterId, setSchemaAdapterId] = useState<string>(SCHEMA_ADAPTER_INHERIT)
    const [parseError, setParseError] = useState<string | null>(null)

    // True when the dialog is open in "create" mode but a model object was
    // supplied — that's the "promote discovered → override" flow.
    const isOverride = useMemo(
        () => mode === "create" && !!model?.is_discovered,
        [mode, model?.is_discovered],
    )

    useEffect(() => {
        if (!open) return
        if (model) {
            // Both edit and "create-override" pre-fill from the model object.
            // Use isOverride to know how to render labels/help text.
            setName(model.name)
            setProviderId(model.provider_id ?? "")
            setUpstreamModelId(model.model_id ?? model.name)
            setType(model.type ?? "chat")
            setContextWindow(model.context_window?.toString() ?? "")
            setMaxTokens(model.max_tokens?.toString() ?? "")
            setOutputDim(model.output_dimension?.toString() ?? "")
            setDescription(model.description ?? "")
            setDefaultParams(JSON.stringify(model.default_params ?? {}, null, 2))
            setEnabled(model.enabled !== false)
            setSchemaAdapterId(model.schema_adapter_id ?? SCHEMA_ADAPTER_INHERIT)
        } else {
            setName("")
            setProviderId(defaultProviderId ?? "")
            setUpstreamModelId("")
            setType("chat")
            setContextWindow("")
            setMaxTokens("")
            setOutputDim("")
            setDescription("")
            setDefaultParams("{}")
            setEnabled(true)
            setSchemaAdapterId(SCHEMA_ADAPTER_INHERIT)
        }
        setParseError(null)
    }, [open, mode, model, defaultProviderId])

    // `models` resource has `invalidates: ["providers"]` so n_models on
    // each provider card refreshes too.
    const createMutation = models.useCreate({
        onSuccess: () => {
            toast.success(isOverride ? "Override saved" : "Model created")
            onOpenChange(false)
        },
        onError: (e) => toast.error(e.message || "Create failed"),
    })

    const updateMutation = models.useUpdate({
        onSuccess: () => {
            toast.success("Model updated")
            onOpenChange(false)
        },
        onError: (e) => toast.error(e.message || "Update failed"),
    })

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault()
        if (!name.trim()) return toast.error("Name required")
        if (!providerId) return toast.error("Provider required")
        if (!upstreamModelId.trim()) return toast.error("Upstream model id required")

        let params: Record<string, unknown> = {}
        try {
            params = defaultParams.trim() ? JSON.parse(defaultParams) : {}
            setParseError(null)
        } catch (err) {
            const msg = err instanceof Error ? err.message : "Invalid JSON"
            setParseError(msg)
            return
        }

        const payload: ModelCreateInput = {
            name: name.trim(),
            provider_id: providerId,
            upstream_model_id: upstreamModelId.trim(),
            type,
            default_params: params,
            context_window: contextWindow ? Number(contextWindow) : null,
            max_tokens: maxTokens ? Number(maxTokens) : null,
            output_dimension: outputDim ? Number(outputDim) : null,
            description: description || null,
            enabled,
            schema_adapter_id: schemaAdapterId === SCHEMA_ADAPTER_INHERIT ? null : schemaAdapterId,
        }

        if (mode === "create") {
            createMutation.mutate(payload)
        } else if (model) {
            updateMutation.mutate({ id: model.id, data: payload })
        }
    }

    const isLoading = createMutation.isPending || updateMutation.isPending
    const title = isOverride ? "Create override" : mode === "create" ? "Add Model" : "Edit Model"
    const submitLabel = isOverride ? "Save override" : mode === "create" ? "Create" : "Save"

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[640px] max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        {isOverride && <Sparkles className="h-4 w-4 text-primary" />}
                        {title}
                    </DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit}>
                    <div className="grid gap-4 py-4">
                        <div className="grid sm:grid-cols-2 gap-3">
                            <div className="grid gap-2 min-w-0">
                                <Label htmlFor="m-name" className="text-xs">Display Name</Label>
                                <Input id="m-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="gpt-4o-mini" className="h-9 text-sm font-mono" />
                            </div>
                            <div className="grid gap-2 min-w-0">
                                <Label htmlFor="m-up" className="text-xs">Upstream Model ID</Label>
                                <Input id="m-up" value={upstreamModelId} onChange={(e) => setUpstreamModelId(e.target.value)} placeholder="gpt-4o-mini" className="h-9 text-sm font-mono" />
                            </div>
                        </div>
                        <div className="grid sm:grid-cols-2 gap-3">
                            <div className="grid gap-2 min-w-0">
                                <Label className="text-xs">Provider</Label>
                                <Select value={providerId} onValueChange={setProviderId}>
                                    <SelectTrigger className="h-9 text-sm">
                                        <SelectValue placeholder="Select provider" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {(providerList ?? []).map((p) => (
                                            <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="grid gap-2 min-w-0">
                                <Label className="text-xs">Capability</Label>
                                <Select value={type} onValueChange={setType}>
                                    <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {(capabilityList ?? []).map((c) => (
                                            <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>
                                        ))}
                                        {/* Allow saving an unregistered id so legacy rows still load */}
                                        {type && !(capabilityList ?? []).some((c) => c.id === type) && (
                                            <SelectItem value={type}>{type}</SelectItem>
                                        )}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        <div className="grid gap-2">
                            <Label className="text-xs">Schema adapter override</Label>
                            <Select value={schemaAdapterId} onValueChange={setSchemaAdapterId}>
                                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value={SCHEMA_ADAPTER_INHERIT}>Inherit from provider</SelectItem>
                                    {(adapterList ?? []).map((a) => (
                                        <SelectItem key={a.id} value={a.id}>{a.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="grid sm:grid-cols-3 gap-3">
                            <div className="grid gap-2 min-w-0">
                                <Label htmlFor="m-ctx" className="text-xs">Context Window</Label>
                                <Input id="m-ctx" type="number" value={contextWindow} onChange={(e) => setContextWindow(e.target.value)} className="h-9 text-sm" />
                            </div>
                            <div className="grid gap-2 min-w-0">
                                <Label htmlFor="m-max" className="text-xs">Max Tokens</Label>
                                <Input id="m-max" type="number" value={maxTokens} onChange={(e) => setMaxTokens(e.target.value)} className="h-9 text-sm" />
                            </div>
                            <div className="grid gap-2 min-w-0">
                                <Label htmlFor="m-dim" className="text-xs">Output Dim</Label>
                                <Input id="m-dim" type="number" value={outputDim} onChange={(e) => setOutputDim(e.target.value)} className="h-9 text-sm" />
                            </div>
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="m-desc" className="text-xs">Description</Label>
                            <Input id="m-desc" value={description} onChange={(e) => setDescription(e.target.value)} className="h-9 text-sm" />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="m-params" className="text-xs">Default params (JSON)</Label>
                            <Textarea id="m-params" value={defaultParams} onChange={(e) => setDefaultParams(e.target.value)} rows={4} className="text-xs font-mono" />
                            {parseError && <span className="text-xs text-destructive">{parseError}</span>}
                        </div>
                        <div className="flex items-center justify-between">
                            <Label htmlFor="m-enabled" className="text-xs">Enabled</Label>
                            <Switch id="m-enabled" checked={enabled} onCheckedChange={setEnabled} />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={isLoading}>Cancel</Button>
                        <Button type="submit" size="sm" disabled={isLoading}>
                            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {submitLabel}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}
