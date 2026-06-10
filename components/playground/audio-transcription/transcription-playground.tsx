"use client"

import * as React from "react"
import { Check, Copy, FileAudio, Mic, Settings2, Upload, X } from "lucide-react"
import { toast } from "sonner"

import { ApiError } from "@/lib/api/client"
import { gateway } from "@/lib/api/gateway"
import type { TranscriptionResponse } from "@/lib/api/gateway"
import {
    useModalityStore,
    type TranscriptionParams,
    type TranscriptionResult,
} from "@/lib/stores/modality-store"
import { cn } from "@/lib/utils"
import { copyToClipboard } from "@/lib/clipboard"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
import { ModalityShell, ModalityShellSubmit } from "@/components/playground/modality-shell"
import { EmptyHint } from "@/components/playground/_parts/playground-primitives"
import { ModalitySingleModelSelector } from "@/components/playground/modality-model-selector"

type ResponseFormat = TranscriptionParams["response_format"]
const FORMATS: ResponseFormat[] = ["json", "text", "srt", "verbose_json", "vtt"]

type Params = TranscriptionParams

const DEFAULTS: Params = { response_format: "verbose_json" }

type Result = TranscriptionResult

const ACCEPT = "audio/*,.mp3,.mp4,.mpeg,.mpga,.m4a,.wav,.webm,.flac,.ogg"
const MAX_BYTES = 25 * 1024 * 1024 // OpenAI's 25 MB limit

export function TranscriptionPlayground() {
    const { model, params, result, error } = useModalityStore((s) => s.transcription)
    const patchTranscription = useModalityStore((s) => s.patchTranscription)
    // File stays local to the component — File objects can't be
    // JSON-serialised so we don't try to persist them across nav.
    // The user re-attaches if they navigated away; everything else
    // (model / params / previous result text) is restored from store.
    const [file, setFile] = React.useState<File | null>(null)
    const [running, setRunning] = React.useState(false)
    const [dragOver, setDragOver] = React.useState(false)

    const setModel = React.useCallback(
        (v: string | null) => patchTranscription({ model: v }),
        [patchTranscription],
    )
    const setParams = React.useCallback(
        (v: Params) => patchTranscription({ params: v }),
        [patchTranscription],
    )

    // Derived object URL — kept out of setState to avoid the "setState
    // synchronously in effect" cascade; cleanup runs on file change.
    const previewUrl = React.useMemo(
        () => (file ? URL.createObjectURL(file) : null),
        [file],
    )
    React.useEffect(() => {
        return () => {
            if (previewUrl) URL.revokeObjectURL(previewUrl)
        }
    }, [previewUrl])

    const acceptFile = React.useCallback((f: File) => {
        if (f.size > MAX_BYTES) {
            toast.error(`File is too large (${(f.size / 1024 / 1024).toFixed(1)} MB; limit 25 MB)`)
            return
        }
        setFile(f)
        patchTranscription({ result: null, error: null })
    }, [patchTranscription])

    const onDrop = React.useCallback(
        (e: React.DragEvent<HTMLLabelElement>) => {
            e.preventDefault()
            setDragOver(false)
            const f = e.dataTransfer.files?.[0]
            if (f) acceptFile(f)
        },
        [acceptFile],
    )

    const canRun = !!model && !!file && !running

    const handleRun = React.useCallback(async () => {
        if (!model) return toast.error("Pick a transcription model")
        if (!file) return toast.error("Upload an audio file")
        patchTranscription({ error: null })
        setRunning(true)
        const started = Date.now()
        try {
            const payload = await gateway.transcribe({
                model,
                file,
                language: params.language || undefined,
                prompt: params.prompt || undefined,
                response_format: params.response_format,
                temperature: params.temperature,
            })
            patchTranscription({
                result: {
                    payload,
                    format: params.response_format,
                    file_name: file.name,
                    file_bytes: file.size,
                    elapsed_ms: Date.now() - started,
                },
            })
        } catch (e) {
            const msg = e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e)
            patchTranscription({ error: msg })
            toast.error(msg)
        } finally {
            setRunning(false)
        }
    }, [model, file, params, patchTranscription])

    return (
        <ModalityShell
            header={
                <ModalitySingleModelSelector
                    capability="audio.transcription"
                    value={model}
                    onChange={setModel}
                />
            }
            error={error}
            result={
                result ? (
                    <ResultPanel result={result} />
                ) : (
                    <EmptyHint
                        icon={Mic}
                        title="Transcript will appear here"
                        description={
                            model
                                ? "Drop an audio file above (mp3 / wav / m4a / webm…) and Loom sends it to Whisper."
                                : "Pick a transcription model to begin."
                        }
                    />
                )
            }
            action={
                <ModalityShellSubmit
                    onClick={handleRun}
                    disabled={!canRun}
                    running={running}
                    label="Transcribe"
                    runningLabel="Transcribing…"
                    hint={file ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : "Drop an audio file to begin"}
                />
            }
        >
            <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                    <Label className="text-xs text-muted-foreground">Audio file</Label>
                    <ParamsPopover value={params} onChange={setParams} />
                </div>
                {!file ? (
                    <label
                        onDragOver={(e) => {
                            e.preventDefault()
                            setDragOver(true)
                        }}
                        onDragLeave={() => setDragOver(false)}
                        onDrop={onDrop}
                        className={cn(
                            "flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed py-10 text-center cursor-pointer transition-colors",
                            dragOver
                                ? "border-primary bg-primary/5"
                                : "border-muted-foreground/30 hover:border-muted-foreground/50",
                        )}
                    >
                        <Upload className="h-6 w-6 text-muted-foreground" />
                        <span className="text-sm">
                            Drop an audio file here, or{" "}
                            <span className="text-primary underline">browse</span>
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                            Supports mp3, mp4, m4a, wav, webm, flac, ogg…
                        </span>
                        <input
                            type="file"
                            accept={ACCEPT}
                            className="sr-only"
                            onChange={(e) => {
                                const f = e.target.files?.[0]
                                if (f) acceptFile(f)
                                e.target.value = ""
                            }}
                        />
                    </label>
                ) : (
                    <div className="rounded-md border p-3 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                            <div className="flex items-start gap-2 min-w-0">
                                <FileAudio className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                                <div className="min-w-0">
                                    <p className="text-sm truncate" title={file.name}>
                                        {file.name}
                                    </p>
                                    <p className="text-[11px] text-muted-foreground">
                                        {(file.size / 1024 / 1024).toFixed(2)} MB · {file.type || "audio"}
                                    </p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setFile(null)}
                                className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-muted text-muted-foreground"
                                aria-label="Remove file"
                            >
                                <X className="h-3.5 w-3.5" />
                            </button>
                        </div>
                        {previewUrl && (
                            <audio src={previewUrl} controls className="w-full h-9" />
                        )}
                    </div>
                )}
            </div>
        </ModalityShell>
    )
}

function ResultPanel({ result }: { result: Result }) {
    const text = typeof result.payload === "string"
        ? result.payload
        : (result.payload as TranscriptionResponse).text ?? ""
    const payload = typeof result.payload === "object"
        ? (result.payload as TranscriptionResponse)
        : null
    const segments = payload?.segments
    const language = payload?.language
    const duration = payload?.duration
    const [copied, setCopied] = React.useState(false)
    const copyTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
    React.useEffect(() => () => {
        if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    }, [])

    const handleCopy = React.useCallback(async () => {
        if (!text) return
        const ok = await copyToClipboard(text)
        if (!ok) return
        if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
        setCopied(true)
        copyTimerRef.current = setTimeout(() => setCopied(false), 1800)
    }, [text])

    return (
        <Card>
            <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="space-y-1 min-w-0">
                        <CardTitle className="text-sm">Transcript</CardTitle>
                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground tabular-nums">
                            <span>{text.length.toLocaleString()} chars</span>
                            {language && (
                                <>
                                    <span className="text-muted-foreground/40">·</span>
                                    <span>{language}</span>
                                </>
                            )}
                            {duration != null && (
                                <>
                                    <span className="text-muted-foreground/40">·</span>
                                    <span>{duration.toFixed(1)}s audio</span>
                                </>
                            )}
                            <span className="text-muted-foreground/40">·</span>
                            <span>{result.elapsed_ms}ms latency</span>
                            <span className="text-muted-foreground/40">·</span>
                            <span>{result.format}</span>
                        </div>
                    </div>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleCopy}
                        disabled={!text}
                        className="h-8 text-xs gap-1.5"
                    >
                        {copied ? (
                            <>
                                <Check className="h-3.5 w-3.5 text-green-500" />
                                Copied
                            </>
                        ) : (
                            <>
                                <Copy className="h-3.5 w-3.5" />
                                Copy
                            </>
                        )}
                    </Button>
                </div>
            </CardHeader>
            <CardContent className="space-y-3">
                <pre className="whitespace-pre-wrap break-words text-sm leading-relaxed bg-muted/40 rounded-md p-3 font-sans max-h-[420px] overflow-y-auto">
                    {text || (
                        <em className="text-muted-foreground">No text returned. Inspect raw payload below.</em>
                    )}
                </pre>
                {segments && segments.length > 0 && (
                    <details className="text-xs">
                        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                            Segments ({segments.length})
                        </summary>
                        <ul className="mt-2 space-y-1 font-mono text-[11px] max-h-64 overflow-y-auto rounded-md border bg-muted/20 p-2">
                            {segments.map((s) => (
                                <li key={s.id} className="flex gap-2">
                                    <span className="text-muted-foreground shrink-0 tabular-nums">
                                        [{s.start.toFixed(2)}–{s.end.toFixed(2)}]
                                    </span>
                                    <span>{s.text}</span>
                                </li>
                            ))}
                        </ul>
                    </details>
                )}
                <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                        Raw payload
                    </summary>
                    <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-muted/40 p-2 font-mono text-[11px]">
                        {typeof result.payload === "string"
                            ? result.payload
                            : JSON.stringify(result.payload, null, 2)}
                    </pre>
                </details>
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
    const active =
        (value.language ? 1 : 0) +
        (value.prompt ? 1 : 0) +
        (value.response_format !== DEFAULTS.response_format ? 1 : 0) +
        (value.temperature != null ? 1 : 0)

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
                <Row label="Response format">
                    <Select
                        value={value.response_format}
                        onValueChange={(v) => set("response_format", v as ResponseFormat)}
                    >
                        <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {FORMATS.map((f) => (
                                <SelectItem key={f} value={f}>
                                    {f}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </Row>
                <Row label="Language (ISO-639-1)">
                    <Input
                        value={value.language ?? ""}
                        onChange={(e) => set("language", e.target.value || undefined)}
                        placeholder="auto"
                        maxLength={5}
                        className="h-8 text-xs"
                    />
                </Row>
                <Row label="Prompt (optional bias)">
                    <textarea
                        value={value.prompt ?? ""}
                        onChange={(e) => set("prompt", e.target.value || undefined)}
                        rows={2}
                        placeholder="Hint domain vocabulary / proper nouns"
                        className="w-full rounded-md border bg-background p-2 text-xs resize-y focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring placeholder:text-muted-foreground/60"
                    />
                </Row>
                <Row label="Temperature">
                    <Input
                        type="number"
                        min={0}
                        max={1}
                        step={0.05}
                        value={value.temperature ?? ""}
                        onChange={(e) =>
                            set(
                                "temperature",
                                e.target.value === "" ? undefined : Number(e.target.value),
                            )
                        }
                        placeholder="Default"
                        className="h-8 text-xs"
                    />
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
