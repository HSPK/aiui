"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Check, Copy, Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { copyToClipboard } from "@/lib/clipboard"

/**
 * Generic JSON / clipboard primitives used by the log-details sheet's
 * inspector panels. Future tweaks (e.g. another export format, or a
 * different copy-feedback affordance) land here and apply to every
 * inspector at once.
 */

export function CopyButton({ text, className }: { text: string; className?: string }) {
    const [copied, setCopied] = useState(false)
    // Hold the "Copied!" → "Copy" timer in a ref so unmount can clear
    // it and we never queue a setState on a removed component.
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    useEffect(() => () => {
        if (timerRef.current) clearTimeout(timerRef.current)
    }, [])
    const handleCopy = async () => {
        const ok = await copyToClipboard(text)
        if (!ok) {
            console.error("Failed to copy")
            return
        }
        if (timerRef.current) clearTimeout(timerRef.current)
        setCopied(true)
        timerRef.current = setTimeout(() => setCopied(false), 2000)
    }
    return (
        <Button
            variant="ghost"
            size="icon"
            className={cn("h-6 w-6", className)}
            onClick={handleCopy}
            title="Copy to clipboard"
        >
            {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3 text-muted-foreground" />}
        </Button>
    )
}

export function JsonActionButtons({
    data,
    filename,
    onClick,
}: {
    data: object
    filename: string
    onClick?: (e: React.MouseEvent) => void
}) {
    const jsonString = useMemo(() => JSON.stringify(data, null, 2), [data])
    const [copied, setCopied] = useState(false)
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    useEffect(() => () => {
        if (timerRef.current) clearTimeout(timerRef.current)
    }, [])

    const handleCopy = async (e: React.MouseEvent) => {
        e.stopPropagation()
        onClick?.(e)
        const ok = await copyToClipboard(jsonString)
        if (!ok) {
            console.error("Failed to copy")
            return
        }
        if (timerRef.current) clearTimeout(timerRef.current)
        setCopied(true)
        timerRef.current = setTimeout(() => setCopied(false), 2000)
    }

    const handleDownload = (e: React.MouseEvent) => {
        e.stopPropagation()
        onClick?.(e)
        const blob = new Blob([jsonString], { type: "application/json" })
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = filename
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
    }

    return (
        <div className="flex items-center gap-0.5 ml-auto mr-2">
            <div
                role="button"
                tabIndex={0}
                className="inline-flex items-center justify-center h-6 w-6 text-muted-foreground hover:text-foreground hover:bg-muted/80 rounded-md cursor-pointer"
                onClick={handleCopy}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleCopy(e as unknown as React.MouseEvent) }}
                title="Copy JSON"
            >
                {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
            </div>
            <div
                role="button"
                tabIndex={0}
                className="inline-flex items-center justify-center h-6 w-6 text-muted-foreground hover:text-foreground hover:bg-muted/80 rounded-md cursor-pointer"
                onClick={handleDownload}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleDownload(e as unknown as React.MouseEvent) }}
                title="Download JSON"
            >
                <Download className="h-3.5 w-3.5" />
            </div>
        </div>
    )
}

/** Heuristic: a base64 blob is a long contiguous run of base64-safe
 *  chars with no whitespace. We catch unprefixed b64 strings (image
 *  generation `data[].b64_json`, audio `audio.data`, …) on top of the
 *  `data:`-URI case so pre-feature logs render cleanly too. */
function isBareBase64Blob(s: string): boolean {
    if (s.length < 4096) return false
    // First 96 chars should be base64-only; cheap probe instead of
    // walking the entire string.
    return /^[A-Za-z0-9+/=]+$/.test(s.slice(0, 96))
}

/** Deep-walk a value and replace base64 image / file blobs with a
 *  short placeholder (`[base64 image png, ~N KB]`). Keeps the JSON
 *  viewer usable for multimodal request bodies and pre-artifact log
 *  responses. Post-artifact image logs already have b64 stripped
 *  server-side so this is a no-op for those. */
export function sanitizeForJsonView(value: unknown, limit = 200): unknown {
    if (typeof value === "string") {
        if (value.startsWith("data:") && value.length > limit) {
            const mime = value.slice(5, value.indexOf(";")) || "binary"
            const kb = Math.round(value.length / 1024)
            const kind = mime.startsWith("image/") ? "image" : "file"
            return `[base64 ${kind} ${mime}, ~${kb} KB]`
        }
        if (isBareBase64Blob(value)) {
            const kb = Math.round(value.length / 1024)
            return `[base64 blob, ~${kb} KB]`
        }
        return value
    }
    if (Array.isArray(value)) return value.map((v) => sanitizeForJsonView(v, limit))
    if (value && typeof value === "object") {
        const out: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            out[k] = sanitizeForJsonView(v, limit)
        }
        return out
    }
    return value
}
