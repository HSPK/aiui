"use client"

import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"

import { capabilities, models, providers, variants } from "@/lib/api"
import type { ModelCreateInput, ModelDTO } from "@/lib/schemas/model"

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

interface Props {
    mode: "create" | "edit"
    /** In create mode: optional seed (e.g. a discovered model being
     *  promoted). In edit mode: the row being edited. */
    model?: ModelDTO | null
    /** Used to pre-select the provider on pure create. Always locked
     *  (provider field becomes read-only) in edit + discovered-promote. */
    defaultProviderId?: string
    onSaved?: (saved: ModelDTO | null) => void
    onCancel?: () => void
}

export function ModelForm({ mode, model, defaultProviderId, onSaved, onCancel }: Props) {
    const { data: providerList } = providers.useList()
    const { data: capabilityList } = capabilities.useList()
    const { data: variantList } = variants.useList()

    const [name, setName] = useState("")
    const [providerId, setProviderId] = useState<string>("")
    const [upstreamModelId, setUpstreamModelId] = useState("")
    const [type, setType] = useState<string>("chat")
    const [apiVariantId, setApiVariantId] = useState<string>("")
    const [contextWindow, setContextWindow] = useState("")
    const [maxTokens, setMaxTokens] = useState("")
    const [outputDim, setOutputDim] = useState("")
    const [description, setDescription] = useState("")
    const [defaultParams, setDefaultParams] = useState("{}")
    const [enabled, setEnabled] = useState(true)
    const [parseError, setParseError] = useState<string | null>(null)

    const isOverride = useMemo(
        () => mode === "create" && !!model?.is_discovered,
        [mode, model?.is_discovered],
    )

    // Provider is locked in edit + discovered-promote. Pure create lets
    // the admin pick freely.
    const providerLocked = mode === "edit" || isOverride
    useEffect(() => {
        if (model) {
            setName(model.name)
            setProviderId(model.provider_id ?? "")
            setUpstreamModelId(model.model_id ?? model.name)
            setType(model.type ?? "chat")
            // Seed the variant dropdown from the gateway's currently-
            // resolved choice (pin → preference walk → capability default).
            // The form has no Auto option — the dropdown always shows a
            // concrete variant the gateway is using right now.
            setApiVariantId(model.api_variant_id ?? model.resolved_variant_id ?? "")
            setContextWindow(model.context_window?.toString() ?? "")
            setMaxTokens(model.max_tokens?.toString() ?? "")
            setOutputDim(model.output_dimension?.toString() ?? "")
            setDescription(model.description ?? "")
            setDefaultParams(JSON.stringify(model.default_params ?? {}, null, 2))
            setEnabled(model.enabled !== false)
        } else {
            setName("")
            setProviderId(defaultProviderId ?? "")
            setUpstreamModelId("")
            setType("chat")
            setApiVariantId("")
            setContextWindow("")
            setMaxTokens("")
            setOutputDim("")
            setDescription("")
            setDefaultParams("{}")
            setEnabled(true)
        }
        setParseError(null)
    }, [mode, model, defaultProviderId])

    const createMutation = models.useCreate({
        onSuccess: (saved) => {
            toast.success("Saved")
            onSaved?.(saved)
        },
        onError: (e) => toast.error(e.message || "Save failed"),
    })

    const updateMutation = models.useUpdate({
        onSuccess: (saved) => {
            toast.success("Saved")
            onSaved?.(saved ?? null)
        },
        onError: (e) => toast.error(e.message || "Save failed"),
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
            setParseError(err instanceof Error ? err.message : "Invalid JSON")
            return
        }

        const payload: ModelCreateInput = {
            name: name.trim(),
            provider_id: providerId,
            upstream_model_id: upstreamModelId.trim(),
            type,
            api_variant_id: apiVariantId || null,
            default_params: params,
            context_window: contextWindow ? Number(contextWindow) : null,
            max_tokens: maxTokens ? Number(maxTokens) : null,
            output_dimension: outputDim ? Number(outputDim) : null,
            description: description || null,
            enabled,
        }

        // When promoting a discovered model into an override, snapshot the
        // raw upstream entry so the gateway can re-project metadata even
        // when the discovery cache is cold.
        if (isOverride && model?.meta?.raw != null) {
            payload.discovered_metadata = model.meta.raw
        }

        if (mode === "create") {
            createMutation.mutate(payload)
        } else if (model) {
            updateMutation.mutate({ id: model.id, data: payload })
        }
    }

    const isLoading = createMutation.isPending || updateMutation.isPending
    const submitLabel = model || mode === "edit" ? "Save" : "Create"

    const variantsForCapability = useMemo(
        () => (variantList ?? []).filter((v) => v.capability === type),
        [variantList, type],
    )
    const selectedProvider = useMemo(
        () => (providerList ?? []).find((p) => p.id === providerId),
        [providerList, providerId],
    )

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-3">
                <Field label="Display name" htmlFor="m-name">
                    <Input
                        id="m-name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="gpt-4o-mini"
                        className="h-9 text-sm font-mono"
                    />
                </Field>
                <Field label="Upstream model ID" htmlFor="m-up">
                    <Input
                        id="m-up"
                        value={upstreamModelId}
                        onChange={(e) => setUpstreamModelId(e.target.value)}
                        placeholder="gpt-4o-mini"
                        className="h-9 text-sm font-mono"
                    />
                </Field>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
                <Field label="Provider">
                    {providerLocked ? (
                        <Input
                            value={selectedProvider?.name ?? providerId}
                            readOnly
                            disabled
                            className="h-9 text-sm font-mono bg-muted/40"
                        />
                    ) : (
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
                    )}
                </Field>
                <Field label="Capability">
                    <Select value={type} onValueChange={setType}>
                        <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            {(capabilityList ?? []).map((c) => (
                                <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>
                            ))}
                            {type && !(capabilityList ?? []).some((c) => c.id === type) && (
                                <SelectItem value={type}>{type}</SelectItem>
                            )}
                        </SelectContent>
                    </Select>
                </Field>
            </div>

            {variantsForCapability.length > 1 && apiVariantId && (
                <Field label="Upstream API">
                    <Select value={apiVariantId} onValueChange={setApiVariantId}>
                        <SelectTrigger className="h-9 text-sm">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {variantsForCapability.map((v) => (
                                <SelectItem key={v.id} value={v.id}>
                                    <span className="font-mono text-xs">{v.id}</span>
                                </SelectItem>
                            ))}
                            {!variantsForCapability.some((v) => v.id === apiVariantId) && (
                                <SelectItem value={apiVariantId}>
                                    <span className="font-mono text-xs">{apiVariantId}</span>
                                </SelectItem>
                            )}
                        </SelectContent>
                    </Select>
                </Field>
            )}

            <div className="grid sm:grid-cols-3 gap-3">
                <Field label="Context window" htmlFor="m-ctx">
                    <Input id="m-ctx" type="number" value={contextWindow} onChange={(e) => setContextWindow(e.target.value)} className="h-9 text-sm" />
                </Field>
                <Field label="Max tokens" htmlFor="m-max">
                    <Input id="m-max" type="number" value={maxTokens} onChange={(e) => setMaxTokens(e.target.value)} className="h-9 text-sm" />
                </Field>
                <Field label="Output dim" htmlFor="m-dim">
                    <Input id="m-dim" type="number" value={outputDim} onChange={(e) => setOutputDim(e.target.value)} className="h-9 text-sm" />
                </Field>
            </div>

            <Field label="Description" htmlFor="m-desc">
                <Input id="m-desc" value={description} onChange={(e) => setDescription(e.target.value)} className="h-9 text-sm" />
            </Field>

            <Field label="Default params (JSON)" htmlFor="m-params">
                <Textarea
                    id="m-params"
                    value={defaultParams}
                    onChange={(e) => setDefaultParams(e.target.value)}
                    rows={5}
                    className="text-xs font-mono"
                />
                {parseError && <span className="text-xs text-destructive">{parseError}</span>}
            </Field>

            <div className="flex items-center justify-between">
                <Label htmlFor="m-enabled" className="text-xs">Enabled</Label>
                <Switch id="m-enabled" checked={enabled} onCheckedChange={setEnabled} />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={onCancel}
                    disabled={isLoading}
                >
                    Cancel
                </Button>
                <Button type="submit" size="sm" disabled={isLoading}>
                    {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {submitLabel}
                </Button>
            </div>
        </form>
    )
}

function Field({
    label,
    htmlFor,
    children,
}: {
    label: string
    htmlFor?: string
    children: React.ReactNode
}) {
    return (
        <div className="grid gap-1.5 min-w-0">
            <Label htmlFor={htmlFor} className="text-xs">{label}</Label>
            {children}
        </div>
    )
}
