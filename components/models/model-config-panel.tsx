"use client"

import * as React from "react"

import type { ModelDTO } from "@/lib/schemas/model"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

interface Props {
    model: ModelDTO
    providerDefaults: Record<string, unknown> | null
}

/** Shows three params blocks (Provider / Model / Effective) and the
 *  verbatim `/models` entry the provider returned. Read-only — edits go
 *  through `/models/<name>/edit`. */
export function ModelConfigPanel({ model, providerDefaults }: Props) {
    const modelDefaults = (model.default_params ?? {}) as Record<string, unknown>
    const effective = React.useMemo(
        () => ({ ...(providerDefaults ?? {}), ...modelDefaults }),
        [providerDefaults, modelDefaults],
    )
    const meta = model.meta ?? null
    const rawMetadata = meta?.raw ?? null

    return (
        <div className="grid gap-4 lg:grid-cols-2">
            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Default parameters</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                    <ParamsBlock label="Provider" sublabel={model.provider ?? undefined} params={providerDefaults} />
                    <ParamsBlock label="Model" sublabel={model.name} params={modelDefaults} />
                    <ParamsBlock label="Effective" params={effective} emphasize />
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Provider /models entry</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                    {meta && (meta.supported_apis?.length || meta.rejected_fields?.length) ? (
                        <div className="flex flex-wrap gap-1">
                            {meta.supported_apis?.map((api) => (
                                <Badge key={api} variant="secondary" className="text-[10px] font-mono">
                                    {api}
                                </Badge>
                            ))}
                            {meta.rejected_fields?.map((f) => (
                                <Badge
                                    key={`rej-${f}`}
                                    variant="outline"
                                    className="text-[10px] font-mono border-destructive/40 text-destructive"
                                    title="Adapter strips this field before sending"
                                >
                                    −{f}
                                </Badge>
                            ))}
                        </div>
                    ) : null}
                    {rawMetadata ? (
                        <pre className="max-h-96 overflow-auto rounded-md border bg-muted/20 p-2 text-[11px] leading-tight font-mono">
                            {JSON.stringify(rawMetadata, null, 2)}
                        </pre>
                    ) : (
                        <p className="text-xs text-muted-foreground">No upstream entry available.</p>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}

function ParamsBlock({
    label,
    sublabel,
    params,
    emphasize,
}: {
    label: string
    sublabel?: string
    params: Record<string, unknown> | null
    emphasize?: boolean
}) {
    const isEmpty = !params || Object.keys(params).length === 0
    return (
        <div className="space-y-1">
            <div className="flex items-baseline gap-2">
                <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    {label}
                </span>
                {sublabel && (
                    <span className="text-[10px] font-mono text-muted-foreground/70 truncate">
                        {sublabel}
                    </span>
                )}
            </div>
            {isEmpty ? (
                <p className="text-[11px] text-muted-foreground/70 italic">empty</p>
            ) : (
                <pre
                    className={
                        emphasize
                            ? "rounded-md border border-primary/30 bg-primary/5 p-2 text-[11px] leading-tight font-mono overflow-auto"
                            : "rounded-md border bg-muted/30 p-2 text-[11px] leading-tight font-mono overflow-auto"
                    }
                >
                    {JSON.stringify(params, null, 2)}
                </pre>
            )}
        </div>
    )
}
