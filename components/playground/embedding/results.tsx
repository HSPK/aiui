"use client"

import * as React from "react"
import { ArrowUpDown, Trophy } from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type {
    PlaygroundEmbeddingModelResult,
    PlaygroundEmbeddingResult,
} from "@/lib/schemas/playground"
import { cn } from "@/lib/utils"

/**
 * Results panel for the embedding playground: per-model card grid,
 * sortable by score / input order. Lives in its own file so the
 * visualisation can evolve (heatmap mode, t-SNE, etc.) without
 * touching the form orchestrator.
 */

export type SortMode = "score" | "original"

export function ResultsSection({ result }: { result: PlaygroundEmbeddingResult }) {
    const [sort, setSort] = React.useState<SortMode>("score")

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <div className="text-xs text-muted-foreground">
                    Query: <span className="text-foreground font-medium">{result.query}</span>{" "}
                    · {result.documents.length} document{result.documents.length === 1 ? "" : "s"}
                    {" · "}
                    {result.results.length} model{result.results.length === 1 ? "" : "s"}
                </div>
                <SortToggle value={sort} onChange={setSort} />
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
                {result.results.map((r) => (
                    <ModelResultCard
                        key={r.model}
                        result={r}
                        documents={result.documents}
                        sort={sort}
                    />
                ))}
            </div>
        </div>
    )
}

function SortToggle({ value, onChange }: { value: SortMode; onChange: (v: SortMode) => void }) {
    return (
        <div className="inline-flex rounded-md border bg-card p-0.5 text-[11px]">
            <button
                type="button"
                onClick={() => onChange("score")}
                className={cn(
                    "inline-flex items-center gap-1 rounded-sm px-2 py-1 transition-colors",
                    value === "score"
                        ? "bg-secondary text-secondary-foreground font-medium"
                        : "text-muted-foreground hover:text-foreground",
                )}
            >
                <ArrowUpDown className="h-3 w-3" />
                Score
            </button>
            <button
                type="button"
                onClick={() => onChange("original")}
                className={cn(
                    "rounded-sm px-2 py-1 transition-colors",
                    value === "original"
                        ? "bg-secondary text-secondary-foreground font-medium"
                        : "text-muted-foreground hover:text-foreground",
                )}
            >
                Input order
            </button>
        </div>
    )
}

function ModelResultCard({
    result,
    documents,
    sort,
}: {
    result: PlaygroundEmbeddingModelResult
    documents: string[]
    sort: SortMode
}) {
    const hasError = !!result.error

    const ranked = React.useMemo(() => {
        if (!result.scores) return []
        const rows = result.scores.map((s) => ({
            index: s.index,
            score: s.score,
            doc: documents[s.index] ?? "",
        }))
        if (sort === "score") rows.sort((a, b) => b.score - a.score)
        return rows
    }, [result.scores, documents, sort])

    return (
        <Card>
            <CardHeader className="space-y-1 pb-2">
                <div className="flex items-start justify-between gap-2 min-w-0">
                    <CardTitle
                        className="text-sm truncate font-mono min-w-0"
                        title={result.model}
                    >
                        {result.model}
                    </CardTitle>
                    {hasError && (
                        <span className="shrink-0 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-destructive/10 text-destructive font-semibold">
                            error
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-3 text-[11px] text-muted-foreground tabular-nums">
                    {result.dim != null && <span>{result.dim} dim</span>}
                    {result.dim != null && <span className="text-muted-foreground/40">·</span>}
                    <span>{result.prompt_tokens ?? "—"} tokens</span>
                    <span className="text-muted-foreground/40">·</span>
                    <span>{result.elapsed_ms}ms</span>
                </div>
            </CardHeader>
            <CardContent className="pt-1">
                {hasError ? (
                    <pre className="whitespace-pre-wrap break-words text-xs text-destructive font-mono">
                        {result.error}
                    </pre>
                ) : ranked.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No scores returned.</p>
                ) : (
                    <ScoreList rows={ranked} sort={sort} />
                )}
            </CardContent>
        </Card>
    )
}

function ScoreList({
    rows,
    sort,
}: {
    rows: Array<{ index: number; score: number; doc: string }>
    sort: SortMode
}) {
    // Color scale relative to this model's own min/max so the bars
    // are visually meaningful even when the absolute score range is
    // narrow (a common case with normalized embedding models).
    const scores = rows.map((r) => r.score)
    const max = Math.max(...scores)
    const min = Math.min(...scores)
    const range = Math.max(0.001, max - min)

    return (
        <ul className="space-y-1.5">
            {rows.map((r, position) => {
                const norm = (r.score - min) / range
                const isTop = sort === "score" && position === 0 && r.score > 0
                return (
                    <li
                        key={r.index}
                        className="grid grid-cols-[20px_1fr_50px] gap-2 items-center"
                    >
                        <span
                            className={cn(
                                "text-[10px] tabular-nums text-muted-foreground flex items-center gap-0.5 justify-end",
                                isTop && "text-primary font-semibold",
                            )}
                        >
                            {isTop && <Trophy className="h-3 w-3" />}
                            {sort === "score" ? position + 1 : r.index + 1}
                        </span>
                        <div className="min-w-0 space-y-1">
                            <p className="text-xs leading-snug line-clamp-2" title={r.doc}>
                                {r.doc || <em className="text-muted-foreground">(empty)</em>}
                            </p>
                            <div className="h-1 w-full rounded-full bg-muted/60 overflow-hidden">
                                <div
                                    className="h-full rounded-full bg-primary/70"
                                    style={{ width: `${Math.max(2, norm * 100)}%` }}
                                />
                            </div>
                        </div>
                        <span
                            className="text-xs tabular-nums font-medium text-right"
                            title={r.score.toString()}
                        >
                            {r.score.toFixed(3)}
                        </span>
                    </li>
                )
            })}
        </ul>
    )
}
