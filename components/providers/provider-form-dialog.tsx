"use client"

import { useEffect, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { ProviderConfig, ProviderCreateParams, ProviderUpdateParams } from "@/lib/types"
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
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { toast } from "sonner"
import { Loader2, Eye, EyeOff } from "lucide-react"

interface Props {
    open: boolean
    onOpenChange: (open: boolean) => void
    mode: "create" | "edit"
    provider?: ProviderConfig | null
}

export function ProviderFormDialog({ open, onOpenChange, mode, provider }: Props) {
    const queryClient = useQueryClient()
    const [name, setName] = useState("")
    const [baseUrl, setBaseUrl] = useState("")
    const [apiKey, setApiKey] = useState("")
    const [showKey, setShowKey] = useState(false)
    const [defaultParams, setDefaultParams] = useState("{}")
    const [documentPage, setDocumentPage] = useState("")
    const [modelPage, setModelPage] = useState("")
    const [enabled, setEnabled] = useState(true)
    const [parseError, setParseError] = useState<string | null>(null)

    useEffect(() => {
        if (!open) return
        if (mode === "edit" && provider) {
            setName(provider.name)
            setBaseUrl(provider.base_url)
            setApiKey("")
            setDefaultParams(JSON.stringify(provider.default_params ?? {}, null, 2))
            setDocumentPage(provider.document_page ?? "")
            setModelPage(provider.model_page ?? "")
            setEnabled(provider.enabled)
        } else {
            setName("")
            setBaseUrl("")
            setApiKey("")
            setDefaultParams("{}")
            setDocumentPage("")
            setModelPage("")
            setEnabled(true)
        }
        setShowKey(false)
        setParseError(null)
    }, [open, mode, provider])

    const createMutation = useMutation({
        mutationFn: (data: ProviderCreateParams) => api.createProvider(data),
        onSuccess: () => {
            toast.success("Provider created")
            queryClient.invalidateQueries({ queryKey: ["providers"] })
            queryClient.invalidateQueries({ queryKey: ["models"] })
            onOpenChange(false)
        },
        onError: (e: Error) => toast.error(e.message || "Create failed"),
    })

    const updateMutation = useMutation({
        mutationFn: ({ id, data }: { id: string; data: ProviderUpdateParams }) =>
            api.updateProvider(id, data),
        onSuccess: () => {
            toast.success("Provider updated")
            queryClient.invalidateQueries({ queryKey: ["providers"] })
            queryClient.invalidateQueries({ queryKey: ["models"] })
            onOpenChange(false)
        },
        onError: (e: Error) => toast.error(e.message || "Update failed"),
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

        if (mode === "create") {
            createMutation.mutate({
                name: name.trim(),
                base_url: baseUrl.trim(),
                api_key: apiKey || undefined,
                default_params: params,
                document_page: documentPage || undefined,
                model_page: modelPage || undefined,
                enabled,
            })
        } else if (provider) {
            const data: ProviderUpdateParams = {
                name: name.trim(),
                base_url: baseUrl.trim(),
                default_params: params,
                document_page: documentPage || undefined,
                model_page: modelPage || undefined,
                enabled,
            }
            if (apiKey) data.api_key = apiKey
            updateMutation.mutate({ id: provider.id, data })
        }
    }

    const isLoading = createMutation.isPending || updateMutation.isPending

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[520px]">
                <DialogHeader>
                    <DialogTitle>{mode === "create" ? "Add Provider" : "Edit Provider"}</DialogTitle>
                    <DialogDescription>
                        Configure an OpenAI-compatible upstream. The API key is stored encrypted at rest.
                    </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit}>
                    <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                            <Label htmlFor="p-name" className="text-xs">Name</Label>
                            <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="openai" className="h-9 text-sm" />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="p-url" className="text-xs">Base URL</Label>
                            <Input id="p-url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.openai.com/v1" className="h-9 text-sm font-mono" />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="p-key" className="text-xs">
                                API Key {mode === "edit" && <span className="text-muted-foreground">(leave blank to keep existing)</span>}
                            </Label>
                            <div className="relative">
                                <Input
                                    id="p-key"
                                    type={showKey ? "text" : "password"}
                                    value={apiKey}
                                    onChange={(e) => setApiKey(e.target.value)}
                                    placeholder={mode === "edit" && provider?.api_key_mask ? provider.api_key_mask : "sk-..."}
                                    className="h-9 text-sm pr-10 font-mono"
                                />
                                <Button type="button" variant="ghost" size="icon" onClick={() => setShowKey(!showKey)} className="absolute right-0 top-0 h-9 w-9 text-muted-foreground">
                                    {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                </Button>
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            <div className="grid gap-2">
                                <Label htmlFor="p-doc" className="text-xs">Docs URL</Label>
                                <Input id="p-doc" value={documentPage} onChange={(e) => setDocumentPage(e.target.value)} className="h-9 text-sm" />
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="p-models" className="text-xs">Models page URL</Label>
                                <Input id="p-models" value={modelPage} onChange={(e) => setModelPage(e.target.value)} className="h-9 text-sm" />
                            </div>
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
