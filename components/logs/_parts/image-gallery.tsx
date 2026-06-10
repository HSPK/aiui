"use client"

import * as React from "react"
import { Download, ImageIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Image-generation log gallery. Walks `log.generation` for entries that
 * point at persisted loom artifacts (set by `persistImageArtifacts`)
 * and renders each as an inline thumbnail. Lives alongside the other
 * log-detail panels — used in place of the plain text "Completion"
 * column when the log's capability is `image`.
 *
 * The b64 payload itself never leaves the server (the log JSON only
 * carries the URL + mime + size), so this component just renders
 * `<img src={url}>` against a same-origin proxy.
 */

interface Artifact {
    index: number
    url: string
    mime?: string
    bytes?: number
}

interface ImageEntry {
    url?: string
    mime?: string
    bytes?: number
    revised_prompt?: string
    loom_artifact?: boolean
}

interface ImageGalleryProps {
    title: string
    colorClass: string
    /** The log's `generation` JSON; we read `loom_artifacts[]` first,
     *  falling back to `data[]` items with `loom_artifact === true`. */
    generation: unknown
    /** Fallback message when no artifacts were persisted (e.g. a log
     *  written before this feature, or a `url`-mode upstream where the
     *  hosted URL has since expired). */
    emptyMessage?: string
}

/** Defense-in-depth against XSS via upstream-forged URLs: only
 *  same-origin paths starting with our artifact route are renderable.
 *  Server-side `persistImageArtifacts` strips upstream-set
 *  `loom_artifact`/`loom_artifacts` markers, so a forged entry should
 *  never reach here — but a `javascript:` URL inside `<a href>` would
 *  execute with admin cookies if it ever did slip through. Keep both
 *  guards. */
function isSafeArtifactUrl(u: unknown): u is string {
    if (typeof u !== "string") return false
    return u.startsWith("/api/logs/generations/")
}

function collectArtifacts(generation: unknown): Artifact[] {
    if (!generation || typeof generation !== "object") return []
    const g = generation as Record<string, unknown>

    // Preferred shape: explicit top-level `loom_artifacts`.
    if (Array.isArray(g.loom_artifacts)) {
        return (g.loom_artifacts as Artifact[]).filter(
            (a) => a && isSafeArtifactUrl(a.url),
        )
    }

    // Fallback: walk data[] looking for the per-entry marker. Pre-feature
    // logs won't have either field — return empty so the caller can
    // render its placeholder.
    if (Array.isArray(g.data)) {
        const out: Artifact[] = []
        ;(g.data as ImageEntry[]).forEach((entry, i) => {
            if (entry?.loom_artifact && isSafeArtifactUrl(entry.url)) {
                out.push({
                    index: i,
                    url: entry.url,
                    mime: entry.mime,
                    bytes: entry.bytes,
                })
            }
        })
        return out
    }
    return []
}

function entryAt(generation: unknown, index: number): ImageEntry | null {
    if (!generation || typeof generation !== "object") return null
    const data = (generation as { data?: unknown }).data
    if (!Array.isArray(data)) return null
    const e = data[index]
    return e && typeof e === "object" ? (e as ImageEntry) : null
}

function fmtBytes(n?: number): string | null {
    if (n == null) return null
    if (n < 1024) return `${n} B`
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
    return `${(n / 1024 / 1024).toFixed(2)} MB`
}

export function ImageGallery({
    title,
    colorClass,
    generation,
    emptyMessage = "No image artifacts persisted for this log.",
}: ImageGalleryProps) {
    const artifacts = React.useMemo(() => collectArtifacts(generation), [generation])

    return (
        <div className="space-y-2 flex-1 min-w-[300px]">
            <h3 className="text-sm font-bold flex items-center gap-2">
                <span className={cn("w-2 h-2 rounded-full", colorClass)} />
                {title}
                {artifacts.length > 0 && (
                    <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">
                        {artifacts.length} image{artifacts.length === 1 ? "" : "s"}
                    </span>
                )}
            </h3>

            {artifacts.length === 0 ? (
                <div className="p-3 bg-muted/10 border border-dashed rounded-md text-sm italic text-muted-foreground flex items-center gap-2">
                    <ImageIcon className="h-4 w-4" />
                    {emptyMessage}
                </div>
            ) : (
                <div className="border rounded-md bg-muted/20 p-2 grid grid-cols-2 md:grid-cols-3 gap-2 max-h-[500px] overflow-y-auto">
                    {artifacts.map((a) => {
                        const entry = entryAt(generation, a.index)
                        const size = fmtBytes(a.bytes ?? entry?.bytes)
                        const mime = a.mime ?? entry?.mime ?? "image/*"
                        return (
                            <figure
                                key={a.index}
                                className="group relative rounded-md overflow-hidden border bg-card"
                            >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                    src={a.url}
                                    alt={entry?.revised_prompt ?? `Artifact ${a.index}`}
                                    className="w-full h-auto object-contain"
                                    loading="lazy"
                                />
                                <a
                                    href={a.url}
                                    download
                                    className={cn(
                                        "absolute top-1.5 right-1.5 inline-flex items-center gap-1 rounded-md bg-background/80 backdrop-blur-sm border px-1.5 py-0.5 text-[10px] opacity-0 transition-opacity",
                                        "group-hover:opacity-100",
                                    )}
                                    title="Download original"
                                >
                                    <Download className="h-3 w-3" />
                                </a>
                                <figcaption className="px-2 py-1 text-[10px] text-muted-foreground border-t bg-muted/30 flex items-center justify-between gap-2">
                                    <span className="font-mono">#{a.index}</span>
                                    <span>
                                        {mime}
                                        {size ? ` · ${size}` : ""}
                                    </span>
                                </figcaption>
                                {entry?.revised_prompt && (
                                    <p
                                        className="px-2 py-1 text-[10px] text-muted-foreground border-t bg-muted/30 line-clamp-2"
                                        title={entry.revised_prompt}
                                    >
                                        <span className="font-medium text-foreground">Revised:</span>{" "}
                                        {entry.revised_prompt}
                                    </p>
                                )}
                            </figure>
                        )
                    })}
                </div>
            )}
        </div>
    )
}
