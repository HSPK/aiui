"use client"

import * as React from "react"
import {
    Download,
    Film,
    ImageIcon,
    Loader2,
    Play,
    Settings2,
    Trash2,
    X,
} from "lucide-react"
import { toast } from "sonner"

import { ApiError } from "@/lib/api/client"
import { gateway } from "@/lib/api/gateway"
import type { VideoJob } from "@/lib/api/gateway"
import { useModalityStore, type VideoParams } from "@/lib/stores/modality-store"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
import { CmdEnterHint, ModalityShell } from "@/components/playground/modality-shell"
import { EmptyHint, PromptChips } from "@/components/playground/_parts/playground-primitives"
import { ModalitySingleModelSelector } from "@/components/playground/modality-model-selector"

const SECONDS_OPTIONS = ["4", "8", "12"]
const SIZE_OPTIONS = ["720x1280", "1280x720", "1024x1792", "1792x1024"]

type Params = VideoParams

const DEFAULTS: Params = {}

const POLL_INTERVAL_MS = 4000
const POLL_TIMEOUT_MS = 10 * 60 * 1000

export function VideoPlayground() {
    const { model, prompt, params, job, error } = useModalityStore((s) => s.video)
    const patchVideo = useModalityStore((s) => s.patchVideo)
    // Reference image stays local — File objects don't survive
    // localStorage and we don't want to bloat the in-memory store
    // either; user re-attaches if needed.
    const [reference, setReference] = React.useState<File | null>(null)
    const [polling, setPolling] = React.useState(false)
    const [submitting, setSubmitting] = React.useState(false)

    const abortRef = React.useRef<{ cancelled: boolean }>({ cancelled: false })

    React.useEffect(() => {
        return () => {
            abortRef.current.cancelled = true
        }
    }, [])

    const refPreviewUrl = React.useMemo(
        () => (reference ? URL.createObjectURL(reference) : null),
        [reference],
    )
    React.useEffect(() => {
        return () => {
            if (refPreviewUrl) URL.revokeObjectURL(refPreviewUrl)
        }
    }, [refPreviewUrl])

    const setModel = React.useCallback(
        (v: string | null) => patchVideo({ model: v }),
        [patchVideo],
    )
    const setPrompt = React.useCallback(
        (v: string) => patchVideo({ prompt: v }),
        [patchVideo],
    )
    const setParams = React.useCallback(
        (v: Params) => patchVideo({ params: v }),
        [patchVideo],
    )

    const canRun = !!model && prompt.trim().length > 0 && !submitting && !polling

    const handleRun = React.useCallback(async () => {
        if (!model) return toast.error("Pick a video model")
        if (!prompt.trim()) return toast.error("Prompt is required")
        patchVideo({ error: null, job: null })
        setSubmitting(true)
        try {
            const created = await gateway.videoCreate({
                model,
                prompt: prompt.trim(),
                seconds: params.seconds,
                size: params.size,
                input_reference: reference ?? undefined,
            })
            patchVideo({ job: created })
            setSubmitting(false)
            // Poll until terminal status. abortRef lets unmount cancel.
            setPolling(true)
            abortRef.current = { cancelled: false }
            const localAbort = abortRef.current
            const startedAt = Date.now()
            let current = created
            while (
                !localAbort.cancelled &&
                current.status !== "completed" &&
                current.status !== "failed"
            ) {
                if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
                    patchVideo({ error: "Polling timed out after 10 minutes — check the job manually." })
                    break
                }
                await sleep(POLL_INTERVAL_MS)
                if (localAbort.cancelled) break
                try {
                    current = await gateway.videoGet(created.id, model)
                    patchVideo({ job: current })
                } catch (e) {
                    const msg = e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e)
                    patchVideo({ error: `Polling failed: ${msg}` })
                    break
                }
            }
            setPolling(false)
        } catch (e) {
            const msg = e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e)
            patchVideo({ error: msg })
            toast.error(msg)
            setSubmitting(false)
        }
    }, [model, prompt, params, reference, patchVideo])

    const handleCancelPoll = React.useCallback(() => {
        abortRef.current.cancelled = true
        setPolling(false)
    }, [])

    const handleDelete = React.useCallback(async () => {
        if (!job || !model) return
        try {
            await gateway.videoDelete(job.id, model)
            toast.success("Video job deleted")
            patchVideo({ job: null })
        } catch (e) {
            const msg = e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e)
            toast.error(msg)
        }
    }, [job, model, patchVideo])

    return (
        <ModalityShell
            header={
                <ModalitySingleModelSelector
                    capability="video"
                    value={model}
                    onChange={setModel}
                />
            }
            error={error}
            result={
                job && model ? (
                    <JobPanel job={job} model={model} onDelete={handleDelete} />
                ) : (
                    <EmptyHint
                        icon={Film}
                        title="Generated videos will appear here"
                        description={
                            model
                                ? "Picks a sample below or write your own prompt. Loom polls the upstream until it's ready."
                                : "Pick a model and write a prompt to begin."
                        }
                    >
                        <PromptChips examples={VIDEO_EXAMPLES} onPick={setPrompt} label="Try" />
                    </EmptyHint>
                )
            }
            action={
                <>
                    <div className="text-xs text-muted-foreground min-w-0 truncate">
                        {polling
                            ? `Polling every 4s · cap 10 min`
                            : params.seconds
                              ? <>Typically <span className="font-medium">{params.seconds}s</span> clip → 30–120s wait</>
                              : <CmdEnterHint />}
                    </div>
                    <div className="flex items-center gap-2">
                        {polling && (
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-10 md:h-9 text-sm"
                                onClick={handleCancelPoll}
                            >
                                Stop polling
                            </Button>
                        )}
                        <Button
                            onClick={handleRun}
                            disabled={!canRun}
                            className="h-10 md:h-9 px-5 text-sm font-medium"
                        >
                            {submitting || polling ? (
                                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                            ) : (
                                <Play className="h-4 w-4 mr-1.5" />
                            )}
                            {submitting
                                ? "Submitting…"
                                : polling
                                  ? `Polling… ${job?.progress ?? 0}%`
                                  : "Generate"}
                        </Button>
                    </div>
                </>
            }
        >
            <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                    <Label htmlFor="video-prompt" className="text-xs text-muted-foreground">
                        Prompt
                    </Label>
                    <ParamsPopover value={params} onChange={setParams} />
                </div>
                <textarea
                    id="video-prompt"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    rows={4}
                    placeholder="A drone shot soaring over a mist-covered redwood forest at sunrise, golden light, cinematic 35mm grain."
                    className="w-full min-h-[120px] rounded-md border bg-background p-3 text-sm leading-relaxed resize-y focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring placeholder:text-muted-foreground/60"
                    onKeyDown={(e) => {
                        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") handleRun()
                    }}
                />
            </div>
            <ReferencePicker file={reference} previewUrl={refPreviewUrl} onChange={setReference} />
        </ModalityShell>
    )
}

const VIDEO_EXAMPLES = [
    "A drone shot soaring over a mist-covered redwood forest at sunrise",
    "A barista pulling a perfect espresso shot in slow motion, 4K macro",
    "A cat in a wizard hat reading a giant spellbook by candlelight",
]

function ReferencePicker({
    file,
    previewUrl,
    onChange,
}: {
    file: File | null
    previewUrl: string | null
    onChange: (next: File | null) => void
}) {
    return (
        <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                <ImageIcon className="h-3.5 w-3.5" />
                Reference image (optional)
            </Label>
            {file ? (
                <div className="flex items-center gap-3 rounded-md border p-2">
                    {previewUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                            src={previewUrl}
                            alt="reference"
                            className="h-16 w-16 object-cover rounded"
                        />
                    )}
                    <div className="flex-1 min-w-0">
                        <p className="text-xs truncate" title={file.name}>
                            {file.name}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                            {(file.size / 1024).toFixed(1)} KB · {file.type || "image"}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => onChange(null)}
                        className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-muted text-muted-foreground"
                        aria-label="Remove reference"
                    >
                        <X className="h-3.5 w-3.5" />
                    </button>
                </div>
            ) : (
                <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground cursor-pointer">
                    <span className="rounded border px-2 py-1">+ image</span>
                    <span>image-to-video guidance frame</span>
                    <input
                        type="file"
                        accept="image/*"
                        className="sr-only"
                        onChange={(e) => {
                            const f = e.target.files?.[0]
                            if (f) onChange(f)
                            e.target.value = ""
                        }}
                    />
                </label>
            )}
        </div>
    )
}

const STATUS_COLOR: Record<VideoJob["status"], string> = {
    queued: "bg-muted text-muted-foreground",
    in_progress: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
    completed: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    failed: "bg-destructive/15 text-destructive",
}

function JobPanel({
    job,
    model,
    onDelete,
}: {
    job: VideoJob
    model: string
    onDelete: () => void
}) {
    const videoUrl = job.status === "completed" ? gateway.videoContentUrl(job.id, model, "video") : null
    const thumbUrl = job.status === "completed" ? gateway.videoContentUrl(job.id, model, "thumbnail") : null

    return (
        <Card>
            <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2 min-w-0">
                        <CardTitle
                            className="text-sm font-mono truncate min-w-0"
                            title={job.id}
                        >
                            {job.id}
                        </CardTitle>
                        <span
                            className={cn(
                                "text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-semibold",
                                STATUS_COLOR[job.status],
                            )}
                        >
                            {job.status}
                        </span>
                    </div>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={onDelete}
                        className="h-7 text-xs"
                    >
                        <Trash2 className="h-3.5 w-3.5 mr-1" />
                        Delete
                    </Button>
                </div>
                <div className="flex items-center gap-3 text-[11px] text-muted-foreground tabular-nums">
                    <span>{job.seconds}s</span>
                    <span className="text-muted-foreground/40">·</span>
                    <span>{job.size}</span>
                    {job.progress != null && (
                        <>
                            <span className="text-muted-foreground/40">·</span>
                            <span>{job.progress}%</span>
                        </>
                    )}
                </div>
            </CardHeader>
            <CardContent className="space-y-3">
                {job.status !== "completed" && job.status !== "failed" && (
                    <div className="h-1.5 w-full rounded-full bg-muted/60 overflow-hidden">
                        <div
                            className="h-full rounded-full bg-primary/70 transition-[width] duration-500"
                            style={{ width: `${Math.max(2, Math.min(100, job.progress ?? 0))}%` }}
                        />
                    </div>
                )}
                {job.status === "failed" && job.error && (
                    <pre className="whitespace-pre-wrap break-words text-xs text-destructive font-mono rounded-md bg-destructive/5 p-2">
                        {job.error.message ?? "Video generation failed."}
                    </pre>
                )}
                {videoUrl && (
                    <>
                        <video
                            src={videoUrl}
                            poster={thumbUrl ?? undefined}
                            controls
                            playsInline
                            className="w-full rounded-md bg-black"
                        />
                        <div className="flex items-center justify-end gap-3 text-[11px]">
                            <a
                                href={videoUrl}
                                download={`${job.id}.mp4`}
                                className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                            >
                                <Download className="h-3 w-3" />
                                Download MP4
                            </a>
                        </div>
                    </>
                )}
                {job.prompt && (
                    <details className="text-xs">
                        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                            Prompt
                        </summary>
                        <p className="mt-1 whitespace-pre-wrap text-foreground">{job.prompt}</p>
                    </details>
                )}
            </CardContent>
        </Card>
    )
}

function ParamsPopover({
    value,
    onChange,
}: {
    value: Params
    onChange: (next: Params) => void
}) {
    const active = (value.seconds ? 1 : 0) + (value.size ? 1 : 0)
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
                <Row label="Seconds (4, 8, 12)">
                    <Select
                        value={value.seconds ?? "default"}
                        onValueChange={(v) => set("seconds", v === "default" ? undefined : v)}
                    >
                        <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="default">Default</SelectItem>
                            {SECONDS_OPTIONS.map((s) => (
                                <SelectItem key={s} value={s}>
                                    {s}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </Row>
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
                            {SIZE_OPTIONS.map((s) => (
                                <SelectItem key={s} value={s}>
                                    {s}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </Row>
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

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}
