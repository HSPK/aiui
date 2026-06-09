"use client"

import * as React from "react"
import { Download, Settings2, Volume2 } from "lucide-react"
import { toast } from "sonner"

import { ApiError } from "@/lib/api/client"
import { gateway } from "@/lib/api/gateway"
import { useModalityStore, type SpeechParams, type SpeechResult } from "@/lib/stores/modality-store"
import { cn } from "@/lib/utils"
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
import { CmdEnterHint, ModalityShell, ModalityShellSubmit } from "@/components/playground/modality-shell"
import { EmptyHint, PromptChips } from "@/components/playground/_parts/playground-primitives"
import { ModalitySingleModelSelector } from "@/components/playground/modality-model-selector"

type Format = SpeechParams["response_format"]
const FORMATS: Format[] = ["mp3", "opus", "aac", "flac", "wav", "pcm"]
const DEFAULT_VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer", "ash", "coral", "sage"]

type Params = SpeechParams

const DEFAULTS: Params = {
    voice: "alloy",
    response_format: "mp3",
    speed: 1,
}

export function SpeechPlayground() {
    const { model, text, params, result, error } = useModalityStore((s) => s.speech)
    const patchSpeech = useModalityStore((s) => s.patchSpeech)
    const [running, setRunning] = React.useState(false)

    const setModel = React.useCallback(
        (v: string | null) => patchSpeech({ model: v }),
        [patchSpeech],
    )
    const setText = React.useCallback(
        (v: string) => patchSpeech({ text: v }),
        [patchSpeech],
    )
    const setParams = React.useCallback(
        (v: Params) => patchSpeech({ params: v }),
        [patchSpeech],
    )

    const canRun = !!model && text.trim().length > 0 && !running

    const handleRun = React.useCallback(async () => {
        if (!model) return toast.error("Pick a TTS model")
        if (!text.trim()) return toast.error("Enter text to synthesise")
        patchSpeech({ error: null })
        setRunning(true)
        const started = Date.now()
        try {
            const blob = await gateway.speech({
                model,
                input: text.trim(),
                voice: params.voice,
                response_format: params.response_format,
                speed: params.speed,
                instructions: params.instructions || undefined,
            })
            const url = URL.createObjectURL(blob)
            // Revoke the previous URL only when REPLACING — navigating
            // away (component unmount) intentionally leaves the URL
            // alive so the audio survives in the store across modality
            // switches.
            if (result?.url) URL.revokeObjectURL(result.url)
            patchSpeech({
                result: {
                    url,
                    format: params.response_format,
                    bytes: blob.size,
                    elapsed_ms: Date.now() - started,
                },
            })
        } catch (e) {
            const msg = e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e)
            patchSpeech({ error: msg })
            toast.error(msg)
        } finally {
            setRunning(false)
        }
    }, [model, text, params, result, patchSpeech])

    const setVoice = React.useCallback(
        (voice: string) => patchSpeech({ params: { ...params, voice } }),
        [patchSpeech, params],
    )

    return (
        <ModalityShell
            header={
                <ModalitySingleModelSelector
                    capability="audio.speech"
                    value={model}
                    onChange={setModel}
                />
            }
            error={error}
            result={
                result ? (
                    <ResultPanel key={result.url} result={result} />
                ) : (
                    <EmptyHint
                        icon={Volume2}
                        title="Generated audio will appear here"
                        description={
                            model
                                ? "Tap a sample text, pick a voice, then Generate."
                                : "Pick a TTS model to begin."
                        }
                    >
                        <PromptChips
                            examples={TTS_SAMPLES}
                            onPick={setText}
                            label="Sample"
                        />
                    </EmptyHint>
                )
            }
            action={
                <ModalityShellSubmit
                    onClick={handleRun}
                    disabled={!canRun}
                    running={running}
                    label="Generate"
                    runningLabel="Synthesising…"
                    hint={
                        <>
                            <span className="tabular-nums">{text.length.toLocaleString()}</span> chars · ≈<span className="tabular-nums">{Math.max(1, Math.round((text.length / 14) / params.speed))}</span>s @ {params.speed}× · <CmdEnterHint />
                        </>
                    }
                />
            }
        >
            <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                    <Label className="text-xs text-muted-foreground">Voice</Label>
                    <ParamsPopover value={params} onChange={setParams} />
                </div>
                <div className="flex flex-wrap gap-1.5">
                    {DEFAULT_VOICES.map((v) => (
                        <button
                            key={v}
                            type="button"
                            onClick={() => setVoice(v)}
                            className={cn(
                                "rounded-full border px-3 h-7 text-xs capitalize transition-colors",
                                params.voice === v
                                    ? "bg-foreground text-background border-foreground"
                                    : "text-muted-foreground hover:text-foreground hover:bg-muted/40",
                            )}
                        >
                            {v}
                        </button>
                    ))}
                </div>
            </div>

            <div className="space-y-1.5">
                <Label htmlFor="tts-text" className="text-xs text-muted-foreground">
                    Text
                </Label>
                <textarea
                    id="tts-text"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    rows={6}
                    placeholder="The quick brown fox jumps over the lazy dog."
                    className="w-full min-h-[140px] rounded-md border bg-background p-3 text-sm leading-relaxed resize-y focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring placeholder:text-muted-foreground/60"
                    onKeyDown={(e) => {
                        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") handleRun()
                    }}
                />
            </div>
        </ModalityShell>
    )
}

const TTS_SAMPLES = [
    "The quick brown fox jumps over the lazy dog.",
    "Breaking news from the editor's desk: a new model just dropped, and the results are extraordinary.",
    "Hey, did you see the weather? Maybe we should reschedule to next Tuesday instead.",
]

function ResultPanel({ result }: { result: SpeechResult }) {
    const kb = (result.bytes / 1024).toFixed(1)
    // useState lazy init pins one timestamp per ResultPanel mount —
    // the parent recreates the panel via `key`-less remount on each
    // new result so the filename effectively changes per generation.
    const [stamp] = React.useState<number>(() => Date.now())
    return (
        <Card>
            <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center justify-between">
                    <span>Output</span>
                    <span className="text-[11px] text-muted-foreground font-normal tabular-nums">
                        {result.format} · {kb} KB · {result.elapsed_ms} ms
                    </span>
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
                <audio src={result.url} controls className="w-full" />
                <div className="flex justify-end">
                    <a
                        href={result.url}
                        download={`speech-${stamp}.${result.format}`}
                        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                    >
                        <Download className="h-3 w-3" />
                        Download
                    </a>
                </div>
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
        (value.response_format !== DEFAULTS.response_format ? 1 : 0) +
        (value.speed !== DEFAULTS.speed ? 1 : 0) +
        (value.instructions ? 1 : 0)

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
                <Row label="Custom voice">
                    <Input
                        value={value.voice}
                        onChange={(e) => set("voice", e.target.value || DEFAULTS.voice)}
                        list="tts-voices"
                        placeholder="Override the inline picker"
                        className="h-8 text-xs"
                    />
                    <datalist id="tts-voices">
                        {DEFAULT_VOICES.map((v) => (
                            <option key={v} value={v} />
                        ))}
                    </datalist>
                </Row>
                <Row label="Format">
                    <Select
                        value={value.response_format}
                        onValueChange={(v) => set("response_format", v as Format)}
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
                <Row label={`Speed (${value.speed.toFixed(2)}×)`}>
                    <input
                        type="range"
                        min={0.25}
                        max={4}
                        step={0.05}
                        value={value.speed}
                        onChange={(e) => set("speed", Number(e.target.value))}
                        className="w-full accent-primary"
                    />
                </Row>
                <Row label="Instructions">
                    <textarea
                        value={value.instructions ?? ""}
                        onChange={(e) => set("instructions", e.target.value || undefined)}
                        rows={2}
                        placeholder="Optional voice style instructions (gpt-4o-mini-tts)"
                        className="w-full rounded-md border bg-background p-2 text-xs resize-y focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring placeholder:text-muted-foreground/60"
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
