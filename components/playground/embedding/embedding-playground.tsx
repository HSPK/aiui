"use client"

import * as React from "react"
import { Database, Search } from "lucide-react"
import { toast } from "sonner"

import { ApiError } from "@/lib/api/client"
import { gateway } from "@/lib/api/gateway"
import type {
    PlaygroundEmbeddingParams,
} from "@/lib/schemas/playground"
import { useModalityStore } from "@/lib/stores/modality-store"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { CmdEnterHint, ModalityShell, ModalityShellSubmit } from "@/components/playground/modality-shell"
import { EmptyHint } from "@/components/playground/_parts/playground-primitives"
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
    const { modelIds, query, docsText, params, result, error } = useModalityStore(
        (s) => s.embedding,
    )
    const patchEmbedding = useModalityStore((s) => s.patchEmbedding)
    const [running, setRunning] = React.useState(false)

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
        patchEmbedding({ error: null })
        setRunning(true)
        try {
            const res = await gateway.playgroundEmbedding({
                models: modelIds,
                query: query.trim(),
                documents: docs,
                params: paramsToWire(params),
            })
            patchEmbedding({ result: res })
        } catch (e) {
            const msg =
                e instanceof ApiError
                    ? e.message
                    : e instanceof Error
                      ? e.message
                      : String(e)
            patchEmbedding({ error: msg })
            toast.error(msg)
        } finally {
            setRunning(false)
        }
    }, [canRun, modelIds, query, docs, params, patchEmbedding])

    const setModelIds = React.useCallback(
        (v: string[]) => patchEmbedding({ modelIds: v }),
        [patchEmbedding],
    )
    const setQuery = React.useCallback(
        (v: string) => patchEmbedding({ query: v }),
        [patchEmbedding],
    )
    const setDocsText = React.useCallback(
        (v: string) => patchEmbedding({ docsText: v }),
        [patchEmbedding],
    )
    const setParams = React.useCallback(
        (v: PlaygroundEmbeddingParams) => patchEmbedding({ params: v }),
        [patchEmbedding],
    )

    const seedExample = React.useCallback(() => {
        patchEmbedding({
            query: "What is the meaning of life?",
            docsText: [
                "42 is the answer to life, the universe, and everything.",
                "The purpose of life is to find your purpose.",
                "Life is what happens while you're busy making other plans.",
                "Eat, sleep, code, repeat.",
                "Pizza is the meaning of life.",
            ].join("\n"),
        })
    }, [patchEmbedding])

    return (
        <ModalityShell
            maxWidth="max-w-6xl"
            header={
                <ModalityMultiModelSelector
                    capability="embedding"
                    value={modelIds}
                    onChange={setModelIds}
                />
            }
            error={error}
            result={
                result ? (
                    <ResultsSection result={result} />
                ) : (
                    <EmptyHint
                        icon={Database}
                        title="Comparison table will appear here"
                        description={
                            modelIds.length > 0
                                ? "Each model embeds the query and every document in one batched call, then we score them by cosine similarity."
                                : "Pick one or more embedding models to compare."
                        }
                    >
                        <button
                            type="button"
                            onClick={seedExample}
                            className="text-xs text-primary hover:underline"
                        >
                            Load an example query
                        </button>
                    </EmptyHint>
                )
            }
            action={
                <ModalityShellSubmit
                    onClick={handleRun}
                    disabled={running || !canRun}
                    running={running}
                    label={`Run · ${modelIds.length || "—"} model${modelIds.length === 1 ? "" : "s"}`}
                    runningLabel="Embedding…"
                    hint={<CmdEnterHint />}
                />
            }
        >
            <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                    <Label
                        htmlFor="embed-query"
                        className="text-xs text-muted-foreground flex items-center gap-1.5"
                    >
                        <Search className="h-3.5 w-3.5" />
                        A — Query
                    </Label>
                    <ParamsPopover value={params} onChange={setParams} />
                </div>
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
        </ModalityShell>
    )
}

// ---------- params popover ----------

