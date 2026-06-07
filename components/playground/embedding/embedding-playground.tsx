"use client"

import * as React from "react"
import {
    AlertCircle,
    ArrowUpDown,
    Database,
    Loader2,
    Play,
    Search,
    Settings2,
    Trophy,
} from "lucide-react"
import { toast } from "sonner"

import { ApiError, gateway } from "@/lib/api"
import type {
    PlaygroundEmbeddingModelResult,
    PlaygroundEmbeddingParams,
    PlaygroundEmbeddingResult,
} from "@/lib/schemas/playground"
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
import { ModalityHeader } from "@/components/playground/modality-header"
import { ModalityMultiModelSelector } from "@/components/playground/modality-multi-model-selector"

const MAX_DOCS = 64

function splitDocuments(raw: string): string[] {
    const lines = raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
    // De-dup while preserving order — repeated documents would just
    // produce identical scores and clutter the table.
    const seen = new Set<string>()
    const out: string[] = []
    for (const l of lines) {
        if (seen.has(l)) continue
        seen.add(l)
        out.push(l)
        if (out.length >= MAX_DOCS) break
    }
    return out
}

export function EmbeddingPlayground() {
    const [modelIds, setModelIds] = React.useState<string[]>([])
    const [query, setQuery] = React.useState("")
    const [docsText, setDocsText] = React.useState("")
    const [params, setParams] = React.useState<PlaygroundEmbeddingParams>({})
    const [running, setRunning] = React.useState(false)
    const [result, setResult] = React.useState<PlaygroundEmbeddingResult | null>(null)
    const [error, setError] = React.useState<string | null>(null)

    const docs = React.useMemo(() => splitDocuments(docsText), [docsText])
    const canRun =
        modelIds.length > 0 && query.trim().length > 0 && docs.length > 0

    const handleRun = React.useCallback(async () => {
        if (!canRun) {
            if (modelIds.length === 0) toast.error("Pick at least one embedding model")
            else if (!query.trim()) toast.error("Query (A) is required")
            else toast.error("Add at least one document line in B")
            return
        }
        setError(null)
        setRunning(true)
        try {
            const res = await gateway.playgroundEmbedding({
                models: modelIds,
                query: query.trim(),
                documents: docs,
                params: paramsToWire(params),
            })
            setResult(res)
        } catch (e) {
            const msg =
                e instanceof ApiError
                    ? e.message
                    : e instanceof Error
                      ? e.message
                      : String(e)
            setError(msg)
            toast.error(msg)
        } finally {
            setRunning(false)
        }
    }, [canRun, modelIds, query, docs, params])

    return (
        <div className="h-full overflow-y-auto">
            <div className="mx-auto w-full max-w-6xl space-y-4 p-4 md:p-6">
                <ModalityHeader
                    title="Embeddings"
                    description={
                        <>
                            Score every document against the query via cosine similarity.
                            Each model runs in parallel and hits{" "}
                            <code className="font-mono text-[11px] bg-muted px-1 py-0.5 rounded">
                                /v1/embeddings
                            </code>{" "}
                            with one batched call.
                        </>
                    }
                    icon={Database}
                    accent="from-emerald-500/20 to-green-500/20"
                />

                <Card>
                    <CardHeader className="space-y-3 pb-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <CardTitle className="text-sm">Request</CardTitle>
                            <ParamsPopover value={params} onChange={setParams} />
                        </div>
                        <ModalityMultiModelSelector
                            capability="embedding"
                            value={modelIds}
                            onChange={setModelIds}
                        />
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-1.5">
                            <Label
                                htmlFor="embed-query"
                                className="text-xs text-muted-foreground flex items-center gap-1.5"
                            >
                                <Search className="h-3.5 w-3.5" />
                                A — Query
                            </Label>
                            <Input
                                id="embed-query"
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                placeholder="What is the meaning of life?"
                                className="h-10"
                                onKeyDown={(e) => {
                                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter")
                                        handleRun()
                                }}
                            />
                        </div>

                        <div className="space-y-1.5">
                            <div className="flex items-center justify-between">
                                <Label
                                    htmlFor="embed-docs"
                                    className="text-xs text-muted-foreground"
                                >
                                    B — Documents{" "}
                                    <span className="text-muted-foreground/70">
                                        ({docs.length}/{MAX_DOCS} lines)
                                    </span>
                                </Label>
                                {docs.length > MAX_DOCS && (
                                    <span className="text-[10px] text-destructive">
                                        Only the first {MAX_DOCS} will be sent
                                    </span>
                                )}
                            </div>
                            <textarea
                                id="embed-docs"
                                value={docsText}
                                onChange={(e) => setDocsText(e.target.value)}
                                rows={8}
                                placeholder={"One document per line. e.g.\n\n42 is the answer to life, the universe, and everything.\nThe purpose of life is to find your purpose.\nLife is what happens while you're busy making other plans."}
                                className="w-full min-h-[180px] rounded-md border bg-background p-3 text-sm font-mono leading-relaxed resize-y focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring placeholder:text-muted-foreground/60"
                                spellCheck={false}
                            />
                        </div>

                        <div className="flex items-center justify-between">
                            <p className="text-xs text-muted-foreground">
                                <kbd className="text-[10px] font-mono bg-muted px-1 py-0.5 rounded">
                                    ⌘/Ctrl + Enter
                                </kbd>{" "}
                                to run
                            </p>
                            <Button onClick={handleRun} size="sm" disabled={running || !canRun}>
                                {running ? (
                                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                                ) : (
                                    <Play className="h-4 w-4 mr-1.5" />
                                )}
                                {running
                                    ? "Embedding…"
                                    : `Run · ${modelIds.length || "—"} model${modelIds.length === 1 ? "" : "s"}`}
                            </Button>
                        </div>
                    </CardContent>
                </Card>

                {error && (
                    <Card className="border-destructive/50 bg-destructive/5">
                        <CardContent className="flex items-start gap-2 py-3 text-sm">
                            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-destructive" />
                            <pre className="whitespace-pre-wrap break-words text-xs text-destructive font-mono">
                                {error}
                            </pre>
                        </CardContent>
                    </Card>
                )}

                {result && <ResultsSection result={result} />}
            </div>
        </div>
    )
}

// ---------- params popover ----------

function ParamsPopover({
    value,
    onChange,
}: {
    value: PlaygroundEmbeddingParams
    onChange: (next: PlaygroundEmbeddingParams) => void
}) {
    const activeCount = countActive(value)
    const set = <K extends keyof PlaygroundEmbeddingParams>(
        key: K,
        next: PlaygroundEmbeddingParams[K]
    ) => onChange({ ...value, [key]: next })

    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button type="button" variant="outline" size="sm" className="h-8 text-xs gap-1.5">
                    <Settings2 className="h-3.5 w-3.5" />
                    Params
                    {activeCount > 0 && (
                        <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
                            {activeCount}
                        </span>
                    )}
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-3 space-y-3" align="end">
                <ParamRow label="Dimensions" hint="Truncate vector length (OpenAI text-embedding-3-*)">
                    <Input
                        type="number"
                        min={1}
                        value={value.dimensions ?? ""}
                        onChange={(e) =>
                            set(
                                "dimensions",
                                e.target.value === "" ? undefined : Math.max(1, Number(e.target.value))
                            )
                        }
                        placeholder="Default"
                        className="h-8 text-xs"
                    />
                </ParamRow>
                <ParamRow label="Encoding format" hint="float | base64">
                    <Select
                        value={value.encoding_format ?? "default"}
                        onValueChange={(v) =>
                            set("encoding_format", v === "default" ? undefined : (v as "float" | "base64"))
                        }
                    >
                        <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="default">Default</SelectItem>
                            <SelectItem value="float">float</SelectItem>
                            <SelectItem value="base64">base64</SelectItem>
                        </SelectContent>
                    </Select>
                </ParamRow>
                <ParamRow label="Input type" hint="Cohere / voyage — search_query, search_document, …">
                    <Input
                        value={value.input_type ?? ""}
                        onChange={(e) => set("input_type", e.target.value || undefined)}
                        placeholder="Default"
                        className="h-8 text-xs"
                    />
                </ParamRow>
                <ParamRow label="User" hint="Opaque user id forwarded upstream">
                    <Input
                        value={value.user ?? ""}
                        onChange={(e) => set("user", e.target.value || undefined)}
                        placeholder="—"
                        className="h-8 text-xs"
                    />
                </ParamRow>
                {activeCount > 0 && (
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => onChange({})}
                        className="w-full text-xs"
                    >
                        Reset
                    </Button>
                )}
            </PopoverContent>
        </Popover>
    )
}

function ParamRow({
    label,
    hint,
    children,
}: {
    label: string
    hint?: string
    children: React.ReactNode
}) {
    return (
        <div className="space-y-1">
            <div className="flex items-baseline justify-between gap-2">
                <Label className="text-xs font-medium">{label}</Label>
                {hint && <span className="text-[10px] text-muted-foreground">{hint}</span>}
            </div>
            {children}
        </div>
    )
}

// ---------- results ----------

type SortMode = "score" | "original"

function ResultsSection({ result }: { result: PlaygroundEmbeddingResult }) {
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
                        : "text-muted-foreground hover:text-foreground"
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
                        : "text-muted-foreground hover:text-foreground"
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
                                isTop && "text-primary font-semibold"
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

// ---------- helpers ----------

function countActive(p: PlaygroundEmbeddingParams): number {
    let n = 0
    if (p.dimensions != null) n++
    if (p.encoding_format) n++
    if (p.input_type) n++
    if (p.user) n++
    return n
}

function paramsToWire(p: PlaygroundEmbeddingParams): PlaygroundEmbeddingParams | undefined {
    const out: PlaygroundEmbeddingParams = {}
    if (p.dimensions != null) out.dimensions = p.dimensions
    if (p.encoding_format) out.encoding_format = p.encoding_format
    if (p.input_type) out.input_type = p.input_type
    if (p.user) out.user = p.user
    return Object.keys(out).length > 0 ? out : undefined
}
