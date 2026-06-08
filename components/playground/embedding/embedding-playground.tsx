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
import { ParamsPopover, paramsToWire } from "./params-popover"
import { ResultsSection } from "./results"

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

