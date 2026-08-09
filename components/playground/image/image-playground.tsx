"use client"

import * as React from "react"
import { Download, ImageIcon as ImageIconBig, Settings2 } from "lucide-react"
import { toast } from "sonner"

import { ApiError } from "@/lib/api/client"
import { gateway } from "@/lib/api/gateway"
import type { ImageGenerationResponse } from "@/lib/api/gateway"
import { useModalityStore } from "@/lib/stores/modality-store"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
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
import { CmdEnterHint, ModalityShell, ModalityShellSubmit } from "@/components/playground/modality-shell"
import { EmptyHint, PromptChips, SkeletonGrid } from "@/components/playground/_parts/playground-primitives"
import { ModalitySingleModelSelector } from "@/components/playground/modality-model-selector"

type Params = {
    n: number
    size?: string
    quality?: string
    style?: string
    response_format?: "url" | "b64_json"
    output_format?: "png" | "jpeg" | "webp"
    background?: "transparent" | "opaque" | "auto"
}

const DEFAULTS: Params = { n: 1 }

/** Schema differences across providers. `gpt-image-1` rejects `style`
 *  + `response_format`, uses different `quality` values, and adds
 *  `background` + `output_format`. `dall-e-3` is the reverse. Treating
 *  the popover as model-aware avoids handing the user a footgun. */
type ImageFamily = "gpt-image" | "dall-e-3" | "dall-e-2" | "generic"

function detectFamily(model: string | null): ImageFamily {
    if (!model) return "generic"
    const m = model.toLowerCase()
    if (m.includes("gpt-image")) return "gpt-image"
    if (m.includes("dall-e-3") || m.includes("dalle-3")) return "dall-e-3"
    if (m.includes("dall-e-2") || m.includes("dalle-2")) return "dall-e-2"
    return "generic"
}

interface FamilyOptions {
    sizes: string[]
    qualities: string[]
    /** Shown in the popover; hidden options are stripped from the request. */
    allowStyle: boolean
    allowResponseFormat: boolean
    allowOutputFormat: boolean
    allowBackground: boolean
    maxN: number
}

const FAMILY_OPTIONS: Record<ImageFamily, FamilyOptions> = {
    "gpt-image": {
        sizes: ["1024x1024", "1024x1536", "1536x1024", "auto"],
        qualities: ["low", "medium", "high", "auto"],
        allowStyle: false,
        allowResponseFormat: false,
        allowOutputFormat: true,
        allowBackground: true,
        maxN: 10,
    },
    "dall-e-3": {
        sizes: ["1024x1024", "1024x1792", "1792x1024"],
        qualities: ["standard", "hd"],
        allowStyle: true,
        allowResponseFormat: true,
        allowOutputFormat: false,
        allowBackground: false,
        maxN: 1, // dall-e-3 only supports n=1
    },
    "dall-e-2": {
        sizes: ["256x256", "512x512", "1024x1024"],
        qualities: [],
        allowStyle: false,
        allowResponseFormat: true,
        allowOutputFormat: false,
        allowBackground: false,
        maxN: 10,
    },
    generic: {
        sizes: ["1024x1024", "1024x1792", "1792x1024", "512x512", "256x256"],
        qualities: ["standard", "hd", "low", "medium", "high", "auto"],
        allowStyle: true,
        allowResponseFormat: true,
        allowOutputFormat: true,
        allowBackground: true,
        maxN: 10,
    },
}

export function ImagePlayground() {
    const { model, prompt, params, result, error } = useModalityStore((s) => s.image)
    const patchImage = useModalityStore((s) => s.patchImage)
    const [running, setRunning] = React.useState(false)

    const family = detectFamily(model)
    const options = FAMILY_OPTIONS[family]

    // Sanitised view: drop fields that the current family rejects.
    // Derived (not stateful) so a model switch is reflected immediately
    // without an effect-driven setState cascade — the underlying
    // `params` state is preserved so switching back keeps the values.
    const sanitised = React.useMemo<Params>(() => {
        const out: Params = { n: Math.min(params.n, options.maxN) }
        if (params.size && options.sizes.includes(params.size)) out.size = params.size
        if (params.quality && options.qualities.includes(params.quality)) out.quality = params.quality
        if (options.allowStyle && params.style) out.style = params.style
        if (options.allowResponseFormat && params.response_format) out.response_format = params.response_format
        if (options.allowOutputFormat && params.output_format) out.output_format = params.output_format
        if (options.allowBackground && params.background) out.background = params.background
        return out
    }, [params, options])

    const canRun = !!model && prompt.trim().length > 0 && !running

    const setModel = React.useCallback(
        (v: string | null) => patchImage({ model: v }),
        [patchImage],
    )
    const setPrompt = React.useCallback(
        (v: string) => patchImage({ prompt: v }),
        [patchImage],
    )
    // `v` is always the FULL `sanitised` shape plus one changed key (see
    // `ParamsPopover`'s own `onChange({ ...value, [key]: next })` below) —
    // never a bare single-field diff. Previously this replaced `params`
    // outright, so any field the current family's `sanitised` view drops
    // (because it's hidden for this model family) was silently discarded
    // from the underlying store the instant the user touched ANY OTHER
    // popover field. Merging onto the full `params` instead preserves
    // those hidden sibling fields — only the keys actually present in the
    // sanitised view (i.e. the ones the popover could have touched) are
    // overwritten.
    const setParams = React.useCallback(
        (v: Params) => patchImage({ params: { ...params, ...v } }),
        [patchImage, params],
    )

    const handleRun = React.useCallback(async () => {
        if (!model) return toast.error("Pick an image model")
        if (!prompt.trim()) return toast.error("Prompt is required")
        patchImage({ error: null })
        setRunning(true)
        try {
            // sanitised already strips fields the family rejects, so the
            // body is safe to forward verbatim.
            const body: Parameters<typeof gateway.imageGenerate>[0] = {
                ...sanitised,
                model,
                prompt: prompt.trim(),
            }
            const res = await gateway.imageGenerate(body)
            patchImage({ result: res })
        } catch (e) {
            const msg = e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e)
            patchImage({ error: msg })
            toast.error(msg)
        } finally {
            setRunning(false)
        }
    }, [model, prompt, sanitised, patchImage])

    return (
        <ModalityShell
            header={
                <ModalitySingleModelSelector
                    capability="image"
                    value={model}
                    onChange={setModel}
                />
            }
            error={error}
            result={
                running ? (
                    <SkeletonGrid count={sanitised.n} />
                ) : result ? (
                    <ResultGrid
                        key={result.created ?? 0}
                        result={result}
                        format={sanitised.output_format}
                        onUseRevised={setPrompt}
                    />
                ) : (
                    <EmptyHint
                        icon={ImageIconBig}
                        title="Generated images will appear here"
                        description={
                            model
                                ? "Tap a sample below or write your own prompt."
                                : "Pick a model and write a prompt to begin."
                        }
                    >
                        <PromptChips examples={IMAGE_EXAMPLES} onPick={setPrompt} label="Try" />
                    </EmptyHint>
                )
            }
            action={
                <ModalityShellSubmit
                    onClick={handleRun}
                    disabled={!canRun}
                    running={running}
                    label={`Generate · ${sanitised.n} image${sanitised.n === 1 ? "" : "s"}`}
                    runningLabel="Generating…"
                    hint={<CmdEnterHint />}
                />
            }
        >
            <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                    <Label htmlFor="image-prompt" className="text-xs text-muted-foreground">
                        Prompt
                    </Label>
                    <ParamsPopover value={sanitised} onChange={setParams} options={options} />
                </div>
                <textarea
                    id="image-prompt"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    rows={4}
                    placeholder="A vivid oil painting of a fox curled up beside a fireplace, dramatic light, photorealistic textures…"
                    className="w-full min-h-[120px] rounded-md border bg-background p-3 text-sm leading-relaxed resize-y focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring placeholder:text-muted-foreground/60"
                    onKeyDown={(e) => {
                        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") handleRun()
                    }}
                />
            </div>
        </ModalityShell>
    )
}

const IMAGE_EXAMPLES = [
    "A vivid oil painting of a fox curled up beside a fireplace",
    "Isometric pixel-art coffee shop at dawn, warm lighting",
    "Cyberpunk Tokyo alley, neon reflections in puddles, raining",
]

function ResultGrid({
    result,
    format,
    onUseRevised,
}: {
    result: ImageGenerationResponse
    format?: string
    onUseRevised: (prompt: string) => void
}) {
    const data = React.useMemo(() => result?.data ?? [], [result?.data])
    // Pinned per-mount via useState lazy init; the parent remounts with
    // a fresh `key` whenever a new result lands so the filename rolls.
    const [stamp] = React.useState<number>(() => Date.now())
    const [lightbox, setLightbox] = React.useState<number | null>(null)
    // Default mime when an upstream returns bare b64 with no content-type
    // hint: most providers return PNG; gpt-image-1 honours `output_format`.
    const mime = format === "jpeg" ? "image/jpeg" : format === "webp" ? "image/webp" : "image/png"
    const ext = format === "jpeg" ? "jpg" : format === "webp" ? "webp" : "png"

    const sources = React.useMemo(() => data.map((d) =>
        d.url ?? (d.b64_json ? `data:${mime};base64,${d.b64_json}` : null),
    ), [data, mime])

    if (data.length === 0) {
        return (
            <Card>
                <CardContent className="py-6 text-sm text-muted-foreground text-center">
                    Upstream returned no images.
                </CardContent>
            </Card>
        )
    }
    return (
        <>
            <div className="space-y-2">
                <div className="text-xs text-muted-foreground">
                    {data.length} image{data.length === 1 ? "" : "s"}
                    {result.usage?.total_tokens != null && ` · ${result.usage.total_tokens} tokens`}
                    {" · "}
                    <span className="text-muted-foreground/70">tap to enlarge</span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {data.map((d, i) => {
                        const src = sources[i]
                        if (!src) return null
                        return (
                            <figure
                                key={i}
                                className="group relative rounded-md overflow-hidden border bg-card"
                            >
                                <button
                                    type="button"
                                    onClick={() => setLightbox(i)}
                                    className="block w-full cursor-zoom-in"
                                    aria-label={`Enlarge image ${i + 1}`}
                                >
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                        src={src}
                                        alt={d.revised_prompt ?? `Generated image ${i + 1}`}
                                        className="w-full h-auto object-contain transition-transform group-hover:scale-[1.01]"
                                        loading="lazy"
                                    />
                                </button>
                                <a
                                    href={src}
                                    download={`image-${stamp}-${i}.${ext}`}
                                    onClick={(e) => e.stopPropagation()}
                                    className={cn(
                                        "absolute top-2 right-2 inline-flex items-center gap-1 rounded-md bg-background/80 backdrop-blur-sm border px-2 py-1 text-[11px]",
                                        "opacity-0 group-hover:opacity-100 transition-opacity",
                                    )}
                                >
                                    <Download className="h-3 w-3" />
                                    Download
                                </a>
                                {d.revised_prompt && (
                                    <figcaption className="px-3 py-2 text-[11px] text-muted-foreground border-t bg-muted/30 flex items-start gap-2">
                                        <span className="flex-1 min-w-0">
                                            <span className="font-medium text-foreground">Revised:</span>{" "}
                                            {d.revised_prompt}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation()
                                                onUseRevised(d.revised_prompt!)
                                                toast.success("Prompt updated to revised version")
                                            }}
                                            className="shrink-0 text-primary hover:underline"
                                        >
                                            Use ↑
                                        </button>
                                    </figcaption>
                                )}
                            </figure>
                        )
                    })}
                </div>
            </div>

            <Dialog open={lightbox !== null} onOpenChange={(open) => !open && setLightbox(null)}>
                <DialogContent className="max-w-[95vw] max-h-[95vh] p-0 overflow-hidden bg-background/95 backdrop-blur-md border-none shadow-2xl">
                    <DialogTitle className="sr-only">Image preview</DialogTitle>
                    {lightbox !== null && sources[lightbox] && (
                        <div className="relative flex items-center justify-center">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                                src={sources[lightbox]!}
                                alt={data[lightbox]?.revised_prompt ?? `Image ${lightbox + 1}`}
                                className="max-w-[95vw] max-h-[90vh] object-contain"
                            />
                            <a
                                href={sources[lightbox]!}
                                download={`image-${stamp}-${lightbox}.${ext}`}
                                className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-md bg-background/80 backdrop-blur-sm border px-3 py-1.5 text-xs hover:bg-background"
                            >
                                <Download className="h-3.5 w-3.5" />
                                Download
                            </a>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </>
    )
}

// ----- params popover -----

const STYLE_OPTIONS = ["vivid", "natural"]
const OUTPUT_FORMAT_OPTIONS = ["png", "jpeg", "webp"] as const
const BACKGROUND_OPTIONS = ["auto", "transparent", "opaque"] as const

function ParamsPopover({
    value,
    onChange,
    options,
}: {
    value: Params
    onChange: (next: Params) => void
    options: FamilyOptions
}) {
    const active =
        (value.size ? 1 : 0) +
        (value.quality ? 1 : 0) +
        (value.style ? 1 : 0) +
        (value.response_format ? 1 : 0) +
        (value.output_format ? 1 : 0) +
        (value.background ? 1 : 0) +
        (value.n !== 1 ? 1 : 0)

    const set = <K extends keyof Params>(key: K, next: Params[K]) =>
        onChange({ ...value, [key]: next })

    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button type="button" variant="outline" size="sm" className="h-8 text-xs gap-1.5">
                    <Settings2 className="h-3.5 w-3.5" />
                    Params
                    {active > 0 && (
                        <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
                            {active}
                        </span>
                    )}
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-3 space-y-3" align="end">
                <Row label={`N (1–${options.maxN})`}>
                    <Input
                        type="number"
                        min={1}
                        max={options.maxN}
                        value={value.n}
                        onChange={(e) =>
                            set(
                                "n",
                                Math.min(options.maxN, Math.max(1, Number(e.target.value) || 1)),
                            )
                        }
                        className="h-8 text-xs"
                    />
                </Row>
                {options.sizes.length > 0 && (
                    <Row label="Size">
                        <Select
                            value={value.size ?? "default"}
                            onValueChange={(v) => set("size", v === "default" ? undefined : v)}
                        >
                            <SelectTrigger className="h-8 text-xs">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="default">Default</SelectItem>
                                {options.sizes.map((s) => (
                                    <SelectItem key={s} value={s}>
                                        {s}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </Row>
                )}
                {options.qualities.length > 0 && (
                    <Row label="Quality">
                        <Select
                            value={value.quality ?? "default"}
                            onValueChange={(v) => set("quality", v === "default" ? undefined : v)}
                        >
                            <SelectTrigger className="h-8 text-xs">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="default">Default</SelectItem>
                                {options.qualities.map((q) => (
                                    <SelectItem key={q} value={q}>
                                        {q}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </Row>
                )}
                {options.allowStyle && (
                    <Row label="Style">
                        <Select
                            value={value.style ?? "default"}
                            onValueChange={(v) => set("style", v === "default" ? undefined : v)}
                        >
                            <SelectTrigger className="h-8 text-xs">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="default">Default</SelectItem>
                                {STYLE_OPTIONS.map((s) => (
                                    <SelectItem key={s} value={s}>
                                        {s}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </Row>
                )}
                {options.allowResponseFormat && (
                    <Row label="Response format">
                        <Select
                            value={value.response_format ?? "default"}
                            onValueChange={(v) =>
                                set(
                                    "response_format",
                                    v === "default" ? undefined : (v as "url" | "b64_json"),
                                )
                            }
                        >
                            <SelectTrigger className="h-8 text-xs">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="default">Default</SelectItem>
                                <SelectItem value="url">url</SelectItem>
                                <SelectItem value="b64_json">b64_json</SelectItem>
                            </SelectContent>
                        </Select>
                    </Row>
                )}
                {options.allowOutputFormat && (
                    <Row label="Output format">
                        <Select
                            value={value.output_format ?? "default"}
                            onValueChange={(v) =>
                                set(
                                    "output_format",
                                    v === "default" ? undefined : (v as "png" | "jpeg" | "webp"),
                                )
                            }
                        >
                            <SelectTrigger className="h-8 text-xs">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="default">Default</SelectItem>
                                {OUTPUT_FORMAT_OPTIONS.map((f) => (
                                    <SelectItem key={f} value={f}>
                                        {f}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </Row>
                )}
                {options.allowBackground && (
                    <Row label="Background">
                        <Select
                            value={value.background ?? "default"}
                            onValueChange={(v) =>
                                set(
                                    "background",
                                    v === "default"
                                        ? undefined
                                        : (v as "transparent" | "opaque" | "auto"),
                                )
                            }
                        >
                            <SelectTrigger className="h-8 text-xs">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="default">Default</SelectItem>
                                {BACKGROUND_OPTIONS.map((b) => (
                                    <SelectItem key={b} value={b}>
                                        {b}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </Row>
                )}
                {active > 0 && (
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => onChange(DEFAULTS)}
                        className="w-full text-xs"
                    >
                        Reset
                    </Button>
                )}
            </PopoverContent>
        </Popover>
    )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="space-y-1">
            <Label className="text-xs font-medium">{label}</Label>
            {children}
        </div>
    )
}
