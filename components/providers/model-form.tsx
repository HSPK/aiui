"use client"

import { useRouter } from "next/navigation"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { Loader2, Sparkles } from "lucide-react"

import { capabilities, models, providers } from "@/lib/api"
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
    /** In create mode: optional seed values (e.g. a discovered model being
     *  promoted). In edit mode: the row being edited. */
    model?: ModelDTO | null
    defaultProviderId?: string
    /** Where to navigate after a successful save / cancel. Defaults to the
     *  model's detail page on save and `router.back()` on cancel. */
    successHref?: string
    cancelHref?: string
}

export function ModelForm({ mode, model, defaultProviderId, successHref, cancelHref }: Props) {
    const router = useRouter()
    const { data: providerList } = providers.useList()
    const { data: capabilityList } = capabilities.useList()

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
    const [parseError, setParseError] = useState<string | null>(null)

    // Promoting a discovered row → "create" mode but with a seed model.
    const isOverride = useMemo(
        () => mode === "create" && !!model?.is_discovered,
        [mode, model?.is_discovered],
    )

    useEffect(() => {
        if (model) {
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
        }
        setParseError(null)
    }, [mode, model, defaultProviderId])

    const navigateAway = (saved?: ModelDTO | null) => {
        if (successHref) {
            router.push(successHref)
            return
        }
        if (saved?.name) {
            router.push(`/models/${encodeURIComponent(saved.name)}`)
            return
        }
        router.back()
    }

    const createMutation = models.useCreate({
        onSuccess: (saved) => {
            toast.success(isOverride ? "Override saved" : "Model created")
            navigateAway(saved)
        },
        onError: (e) => toast.error(e.message || "Create failed"),
    })

    const updateMutation = models.useUpdate({
        onSuccess: (saved) => {
            toast.success("Model updated")
            navigateAway(saved ?? null)
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
            setParseError(err instanceof Error ? err.message : "Invalid JSON")
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
        }

        // Snapshot the raw upstream entry when promoting a discovered model.
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
    const title = isOverride ? "Create override" : mode === "create" ? "Add model" : "Edit model"
    const submitLabel = isOverride ? "Save override" : mode === "create" ? "Create" : "Save"

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <div className="flex items-center gap-2">
                {isOverride && <Sparkles className="h-4 w-4 text-primary" />}
                <h2 className="text-base font-semibold tracking-tight">{title}</h2>
            </div>

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
                    rows={6}
                    className="text-xs font-mono"
                />
                {parseError && <span className="text-xs text-destructive">{parseError}</span>}
            </Field>

            <div className="flex items-center justify-between">
                <Label htmlFor="m-enabled" className="text-xs">Enabled</Label>
                <Switch id="m-enabled" checked={enabled} onCheckedChange={setEnabled} />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t">
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => (cancelHref ? router.push(cancelHref) : router.back())}
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
