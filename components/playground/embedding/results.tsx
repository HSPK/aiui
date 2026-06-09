"use client"

import * as React from "react"
import { ArrowUpDown, LayoutGrid, Table as TableIcon, Trophy } from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type {
    PlaygroundEmbeddingModelResult,
    PlaygroundEmbeddingResult,
} from "@/lib/schemas/playground"
import { cn } from "@/lib/utils"

/**
 * Results panel for the embedding playground.
 *
 * Two views, toggled by the user:
 *   - **Cards** (default for 1 model): per-model ranked list with
 *     score bars — best at spot-checking a single model.
 *   - **Table** (default for 2+ models): docs × models matrix with
 *     per-cell heatmap shading — best at comparing models head-to-head.
 *
 * Table also highlights the winning model per row with a trophy.
 */

export type SortMode = "score" | "original"
export type ViewMode = "cards" | "table"

export function ResultsSection({ result }: { result: PlaygroundEmbeddingResult }) {
    const [sort, setSort] = React.useState<SortMode>("score")
    const [view, setView] = React.useState<ViewMode>(
        result.results.length >= 2 ? "table" : "cards",
    )

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="text-xs text-muted-foreground min-w-0">
                    Query: <span className="text-foreground font-medium">{result.query}</span>{" "}
                    · {result.documents.length} document{result.documents.length === 1 ? "" : "s"}
                    {" · "}
                    {result.results.length} model{result.results.length === 1 ? "" : "s"}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <ViewToggle value={view} onChange={setView} />
                    <SortToggle value={sort} onChange={setSort} />
                </div>
            </div>

            {view === "table" ? (
                <ComparisonTable result={result} sort={sort} />
            ) : (
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
            )}
        </div>
    )
}

function ViewToggle({ value, onChange }: { value: ViewMode; onChange: (v: ViewMode) => void }) {
    return (
        <div className="inline-flex rounded-md border bg-card p-0.5 text-[11px]">
            <button
                type="button"
                onClick={() => onChange("table")}
                className={cn(
                    "inline-flex items-center gap-1 rounded-sm px-2 py-1 transition-colors",
                    value === "table"
                        ? "bg-secondary text-secondary-foreground font-medium"
                        : "text-muted-foreground hover:text-foreground",
                )}
            >
                <TableIcon className="h-3 w-3" />
                Table
            </button>
            <button
                type="button"
                onClick={() => onChange("cards")}
                className={cn(
                    "inline-flex items-center gap-1 rounded-sm px-2 py-1 transition-colors",
                    value === "cards"
                        ? "bg-secondary text-secondary-foreground font-medium"
                        : "text-muted-foreground hover:text-foreground",
                )}
            >
                <LayoutGrid className="h-3 w-3" />
                Cards
            </button>
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

function ComparisonTable({
    result,
    sort,
}: {
    result: PlaygroundEmbeddingResult
    sort: SortMode
}) {
    // Build the docId → modelId → score lookup.
    const modelMeta = React.useMemo(
        () => result.results.map((r) => ({
            model: r.model,
            error: r.error,
            dim: r.dim,
            tokens: r.prompt_tokens,
            elapsed: r.elapsed_ms,
        })),
        [result.results],
    )

    // For each document, the score from each model. Order by max-score
    // (best overall doc first) when sort=score; otherwise input order.
    const rows = React.useMemo(() => {
        const arr = result.documents.map((doc, i) => {
            const scores = result.results.map((r) => r.scores?.find((s) => s.index === i)?.score ?? null)
            const validScores = scores.filter((s): s is number => s !== null)
            const maxScore = validScores.length > 0 ? Math.max(...validScores) : -Infinity
            const minScore = validScores.length > 0 ? Math.min(...validScores) : Infinity
            const winner = scores.reduce<{ idx: number; score: number } | null>(
                (best, s, idx) => (s != null && (!best || s > best.score) ? { idx, score: s } : best),
                null,
            )
            return { index: i, doc, scores, maxScore, minScore, winner }
        })
        if (sort === "score") arr.sort((a, b) => b.maxScore - a.maxScore)
        return arr
    }, [result.documents, result.results, sort])

    // Color scale uses each column's own min/max so models with
    // different absolute ranges (normalised vs not) all visualise
    // meaningfully against themselves.
    const perColRange = React.useMemo(() => {
        return modelMeta.map((_, j) => {
            const colScores = rows.map((r) => r.scores[j]).filter((s): s is number => s != null)
            if (colScores.length === 0) return { min: 0, max: 1 }
            return { min: Math.min(...colScores), max: Math.max(...colScores) }
        })
    }, [rows, modelMeta])

    return (
        <Card>
            <CardContent className="p-0 overflow-x-auto">
                <table className="w-full text-xs">
                    <thead>
                        <tr className="border-b">
                            <th className="text-left font-medium text-muted-foreground px-3 py-2 sticky left-0 bg-background">
                                Document
                            </th>
                            {modelMeta.map((m) => (
                                <th
                                    key={m.model}
                                    className="text-left font-medium px-3 py-2 min-w-[140px]"
                                    title={`${m.dim ?? "?"} dim · ${m.tokens ?? "—"} tokens · ${m.elapsed}ms`}
                                >
                                    <div className="font-mono truncate max-w-[180px]" title={m.model}>
                                        {m.model}
                                    </div>
                                    <div className="text-[10px] text-muted-foreground/70 font-normal tabular-nums">
                                        {m.dim ?? "?"}d · {m.elapsed}ms
                                    </div>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((r) => (
                            <tr key={r.index} className="border-b last:border-b-0 hover:bg-muted/20">
                                <td className="px-3 py-2 align-top sticky left-0 bg-background group-hover:bg-muted/20">
                                    <div className="flex items-start gap-1.5">
                                        <span className="text-muted-foreground/60 shrink-0 tabular-nums text-[10px] mt-0.5">
                                            #{r.index + 1}
                                        </span>
                                        <span
                                            className="max-w-[300px] truncate text-foreground"
                                            title={r.doc}
                                        >
                                            {r.doc}
                                        </span>
                                    </div>
                                </td>
                                {r.scores.map((score, j) => {
                                    const range = perColRange[j]
                                    const norm = score == null
                                        ? 0
                                        : (score - range.min) / Math.max(0.001, range.max - range.min)
                                    const isWinner = r.winner?.idx === j
                                    if (score == null) {
                                        return (
                                            <td key={j} className="px-3 py-2 text-muted-foreground/40 italic">
                                                —
                                            </td>
                                        )
                                    }
                                    return (
                                        <td
                                            key={j}
                                            className="px-3 py-2 relative tabular-nums"
                                            title={score.toString()}
                                        >
                                            <div
                                                aria-hidden
                                                className="absolute inset-y-0 left-0 bg-primary/15"
                                                style={{ width: `${Math.max(2, norm * 100)}%` }}
                                            />
                                            <div className={cn(
                                                "relative inline-flex items-center gap-1 font-medium",
                                                isWinner && "text-primary",
                                            )}>
                                                {isWinner && <Trophy className="h-3 w-3" />}
                                                {score.toFixed(3)}
                                            </div>
                                        </td>
                                    )
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
                {modelMeta.some((m) => m.error) && (
                    <div className="border-t bg-destructive/5 px-3 py-2 text-[11px] text-destructive space-y-1">
                        {modelMeta
                            .filter((m) => m.error)
                            .map((m) => (
                                <div key={m.model} className="font-mono">
                                    <span className="font-semibold">{m.model}:</span> {m.error}
                                </div>
                            ))}
                    </div>
                )}
            </CardContent>
        </Card>
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
