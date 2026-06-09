"use client"

import * as React from "react"
import { AlertCircle, Loader2, Play } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { cn } from "@/lib/utils"

/**
 * Shared chrome for the non-chat playground modalities (image, TTS,
 * transcription, video, embedding). Every modality reduces to the
 * same flow:
 *
 *   1. Pick a model + tune optional params           → `header` slot
 *   2. Provide primary input (prompt / file / text)  → `children`
 *   3. Submit a generation                           → `action` (bottom)
 *   4. Surface errors                                → `error` (auto)
 *   5. Show the latest result                        → `result` slot
 *
 * Standardising the layout here gives the modality pages a single
 * design language (spacing rhythm, card chrome, error treatment) and
 * removes the per-page `<ModalityHeader>` boilerplate the user
 * rightly flagged as unnecessary chrome.
 */

interface ModalityShellProps {
    /** Top-of-card row — typically `<ModalityModelSelector /> + <ParamsPopover />`. */
    header: React.ReactNode
    /** Primary inputs: prompt textarea, file picker, query + docs, etc. */
    children: React.ReactNode
    /** Bottom action row. Either use `<ModalityShell.Submit>` for the
     *  common case or render custom content (e.g. video's submit +
     *  stop-poll pair). */
    action: React.ReactNode
    /** Error message — renders a destructive card below the form. */
    error?: string | null
    /** Latest result — renders below the form. Each modality owns the
     *  shape (image grid, audio player, video, transcript). */
    result?: React.ReactNode
    /** Override the default `max-w-4xl` content width. Embedding uses
     *  `max-w-6xl` for its comparison table. */
    maxWidth?: string
}

export function ModalityShell({
    header,
    children,
    action,
    error,
    result,
    maxWidth = "max-w-4xl",
}: ModalityShellProps) {
    return (
        <div className="h-full overflow-y-auto">
            <div className={cn("mx-auto w-full p-4 md:p-6 space-y-4", maxWidth)}>
                <Card>
                    <CardHeader className="pb-3">{header}</CardHeader>
                    <CardContent className="space-y-4 pt-0">
                        {children}
                        <div className="flex items-center justify-between gap-2 flex-wrap pt-1">
                            {action}
                        </div>
                    </CardContent>
                </Card>

                {error && <ErrorCard message={error} />}
                {result}
            </div>
        </div>
    )
}

function ErrorCard({ message }: { message: string }) {
    return (
        <Card className="border-destructive/50 bg-destructive/5">
            <CardContent className="flex items-start gap-2 py-3 text-sm">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-destructive" />
                <pre className="whitespace-pre-wrap break-words text-xs text-destructive font-mono">
                    {message}
                </pre>
            </CardContent>
        </Card>
    )
}

interface SubmitButtonProps {
    onClick: () => void
    disabled?: boolean
    running?: boolean
    /** Idle label (e.g. "Generate", "Transcribe", "Run"). */
    label: string
    /** Running label (e.g. "Generating…"). */
    runningLabel?: string
    /** Optional left-aligned hint line — e.g. keyboard shortcut. */
    hint?: React.ReactNode
}

/** Stable primary-action button matching the design language. Lives
 *  inside `<ModalityShell.action>` slot; left of it can sit `hint`,
 *  right of it auxiliary buttons (e.g. video's Stop polling). */
export function ModalityShellSubmit({
    onClick,
    disabled,
    running,
    label,
    runningLabel,
    hint,
}: SubmitButtonProps) {
    return (
        <>
            <div className="text-xs text-muted-foreground min-w-0">{hint}</div>
            <Button
                onClick={onClick}
                disabled={disabled}
                className="h-10 md:h-9 px-5 text-sm font-medium"
            >
                {running ? (
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                    <Play className="h-4 w-4 mr-1.5" />
                )}
                {running ? (runningLabel ?? "Working…") : label}
            </Button>
        </>
    )
}

/** Reusable keyboard-shortcut hint with `⌘/Ctrl + Enter`. */
export function CmdEnterHint({ children }: { children?: React.ReactNode }) {
    return (
        <>
            <kbd className="text-[10px] font-mono bg-muted px-1 py-0.5 rounded">
                ⌘/Ctrl + Enter
            </kbd>{" "}
            to run
            {children}
        </>
    )
}
