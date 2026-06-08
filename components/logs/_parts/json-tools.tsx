"use client"

import { useMemo, useState } from "react"
import { Check, Copy, Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * Generic JSON / clipboard primitives used by the log-details sheet's
 * inspector panels. Future tweaks (e.g. another export format, or a
 * different copy-feedback affordance) land here and apply to every
 * inspector at once.
 */

export function CopyButton({ text, className }: { text: string; className?: string }) {
    const [copied, setCopied] = useState(false)
    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(text)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        } catch (err) {
            console.error("Failed to copy:", err)
        }
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

    const handleCopy = async (e: React.MouseEvent) => {
        e.stopPropagation()
        onClick?.(e)
        try {
            await navigator.clipboard.writeText(jsonString)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        } catch (err) {
            console.error("Failed to copy:", err)
        }
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

/** Deep-walk a value and replace `data:<mime>;base64,…` strings longer
 *  than `limit` with a placeholder `[base64 image|file, N KB]`. Keeps
 *  the JSON viewer usable when the request body is multimodal. */
export function sanitizeForJsonView(value: unknown, limit = 200): unknown {
    if (typeof value === "string") {
        if (value.startsWith("data:") && value.length > limit) {
            const mime = value.slice(5, value.indexOf(";")) || "binary"
            const kb = Math.round(value.length / 1024)
            const kind = mime.startsWith("image/") ? "image" : "file"
            return `[base64 ${kind} ${mime}, ~${kb} KB]`
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
