"use client"

import * as React from "react"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"

import { tools } from "@/lib/api"
import type { ToolCreateInput, ToolDTO } from "@/lib/schemas/tool"

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

interface Props {
    open: boolean
    onOpenChange: (open: boolean) => void
    mode: "create" | "edit"
    tool?: ToolDTO | null
}

const DEFAULT_PARAMETERS = `{
  "type": "object",
  "properties": {},
  "required": []
}`

export function ToolFormDialog({ open, onOpenChange, mode, tool }: Props) {
    const [name, setName] = React.useState("")
    const [description, setDescription] = React.useState("")
    const [parameters, setParameters] = React.useState(DEFAULT_PARAMETERS)
    const [webhookUrl, setWebhookUrl] = React.useState("")
    const [enabled, setEnabled] = React.useState(true)
    const [parseError, setParseError] = React.useState<string | null>(null)

    React.useEffect(() => {
        if (!open) return
        if (tool) {
            setName(tool.name)
            setDescription(tool.description ?? "")
            setParameters(JSON.stringify(tool.parameters ?? {}, null, 2))
            setWebhookUrl(tool.webhook_url ?? "")
            setEnabled(tool.enabled !== false)
        } else {
            setName("")
            setDescription("")
            setParameters(DEFAULT_PARAMETERS)
            setWebhookUrl("")
            setEnabled(true)
        }
        setParseError(null)
    }, [open, tool])

    const createMutation = tools.useCreate({
        onSuccess: () => {
            toast.success("Saved")
            onOpenChange(false)
        },
        onError: (e) => toast.error(e.message || "Save failed"),
    })

    const updateMutation = tools.useUpdate({
        onSuccess: () => {
            toast.success("Saved")
            onOpenChange(false)
        },
        onError: (e) => toast.error(e.message || "Save failed"),
    })

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault()
        if (!name.trim()) return toast.error("Name required")

        let params: Record<string, unknown> = {}
        try {
            params = parameters.trim() ? JSON.parse(parameters) : {}
            setParseError(null)
        } catch (err) {
            setParseError(err instanceof Error ? err.message : "Invalid JSON")
            return
        }

        const payload: ToolCreateInput = {
            name: name.trim(),
            description: description.trim(),
            parameters: params,
            webhook_url: webhookUrl.trim() || null,
            enabled,
        }

        if (mode === "create") createMutation.mutate(payload)
        else if (tool) updateMutation.mutate({ id: tool.id, data: payload })
    }

    const isLoading = createMutation.isPending || updateMutation.isPending
    const title = mode === "create" ? "Add tool" : "Edit"

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
                    <div className="grid sm:grid-cols-2 gap-3">
                        <Field label="Name" htmlFor="t-name">
                            <Input
                                id="t-name"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="get_weather"
                                className="h-9 text-sm font-mono"
                            />
                        </Field>
                        <Field label="Webhook URL" htmlFor="t-webhook">
                            <Input
                                id="t-webhook"
                                value={webhookUrl}
                                onChange={(e) => setWebhookUrl(e.target.value)}
                                placeholder="https://…"
                                className="h-9 text-sm font-mono"
                            />
                        </Field>
                    </div>

                    <Field label="Description" htmlFor="t-desc">
                        <Input
                            id="t-desc"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            className="h-9 text-sm"
                        />
                    </Field>

                    <Field label="Parameters (JSON Schema)" htmlFor="t-params">
                        <Textarea
                            id="t-params"
                            value={parameters}
                            onChange={(e) => setParameters(e.target.value)}
                            rows={10}
                            className="text-xs font-mono"
                        />
                        {parseError && <span className="text-xs text-destructive">{parseError}</span>}
                    </Field>

                    <div className="flex items-center justify-between">
                        <Label htmlFor="t-enabled" className="text-xs">Enabled</Label>
                        <Switch id="t-enabled" checked={enabled} onCheckedChange={setEnabled} />
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
