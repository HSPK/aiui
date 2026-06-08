"use client"

import * as React from "react"
import { Settings2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import type { PlaygroundEmbeddingParams } from "@/lib/schemas/playground"

/**
 * Popover surface for tweaking optional embedding params (dimensions,
 * encoding_format, input_type, user). Activates a small counter on
 * the trigger when any field is set. Lives separately so future
 * params (e.g. a per-provider passthrough) land in one file without
 * touching the embedding orchestrator.
 */

export function ParamsPopover({
    value,
    onChange,
}: {
    value: PlaygroundEmbeddingParams
    onChange: (next: PlaygroundEmbeddingParams) => void
}) {
    const activeCount = countActive(value)
    const set = <K extends keyof PlaygroundEmbeddingParams>(
        key: K,
        next: PlaygroundEmbeddingParams[K],
    ) => onChange({ ...value, [key]: next })

    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button type="button" variant="outline" size="sm" className="h-8 text-xs gap-1.5">
                    <Settings2 className="h-3.5 w-3.5" />
                    Params
                    {activeCount > 0 && (
                        <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
                            {activeCount}
                        </span>
                    )}
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-3 space-y-3" align="end">
                <ParamRow label="Dimensions" hint="Truncate vector length (OpenAI text-embedding-3-*)">
                    <Input
                        type="number"
                        min={1}
                        value={value.dimensions ?? ""}
                        onChange={(e) =>
                            set(
                                "dimensions",
                                e.target.value === "" ? undefined : Math.max(1, Number(e.target.value)),
                            )
                        }
                        placeholder="Default"
                        className="h-8 text-xs"
                    />
                </ParamRow>
                <ParamRow label="Encoding format" hint="float | base64">
                    <Select
                        value={value.encoding_format ?? "default"}
                        onValueChange={(v) =>
                            set("encoding_format", v === "default" ? undefined : (v as "float" | "base64"))
                        }
                    >
                        <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="default">Default</SelectItem>
                            <SelectItem value="float">float</SelectItem>
                            <SelectItem value="base64">base64</SelectItem>
                        </SelectContent>
                    </Select>
                </ParamRow>
                <ParamRow label="Input type" hint="Cohere / voyage — search_query, search_document, …">
                    <Input
                        value={value.input_type ?? ""}
                        onChange={(e) => set("input_type", e.target.value || undefined)}
                        placeholder="Default"
                        className="h-8 text-xs"
                    />
                </ParamRow>
                <ParamRow label="User" hint="Opaque user id forwarded upstream">
                    <Input
                        value={value.user ?? ""}
                        onChange={(e) => set("user", e.target.value || undefined)}
                        placeholder="—"
                        className="h-8 text-xs"
                    />
                </ParamRow>
                {activeCount > 0 && (
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => onChange({})}
                        className="w-full text-xs"
                    >
                        Reset
                    </Button>
                )}
            </PopoverContent>
        </Popover>
    )
}

function ParamRow({
    label,
    hint,
    children,
}: {
    label: string
    hint?: string
    children: React.ReactNode
}) {
    return (
        <div className="space-y-1">
            <div className="flex items-baseline justify-between gap-2">
                <Label className="text-xs font-medium">{label}</Label>
                {hint && <span className="text-[10px] text-muted-foreground">{hint}</span>}
            </div>
            {children}
        </div>
    )
}

export function countActive(p: PlaygroundEmbeddingParams): number {
    let n = 0
    if (p.dimensions != null) n++
    if (p.encoding_format) n++
    if (p.input_type) n++
    if (p.user) n++
    return n
}

export function paramsToWire(p: PlaygroundEmbeddingParams): PlaygroundEmbeddingParams | undefined {
    const out: PlaygroundEmbeddingParams = {}
    if (p.dimensions != null) out.dimensions = p.dimensions
    if (p.encoding_format) out.encoding_format = p.encoding_format
    if (p.input_type) out.input_type = p.input_type
    if (p.user) out.user = p.user
    return Object.keys(out).length > 0 ? out : undefined
}
