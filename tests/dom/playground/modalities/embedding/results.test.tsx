import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { ResultsSection } from "@/components/playground/embedding/results"
import type { PlaygroundEmbeddingResult } from "@/lib/schemas/playground"

afterEach(() => {
    cleanup()
})

const twoModelResult: PlaygroundEmbeddingResult = {
    query: "What is the meaning of life?",
    documents: ["Pizza is life", "42 is the answer", "Life happens"],
    results: [
        {
            model: "text-embedding-3-small",
            query_vector: [0.1, 0.2],
            document_vectors: [[0.1, 0.2], [0.3, 0.4], [0.5, 0.6]],
            dim: 1536,
            scores: [
                { index: 0, score: 0.3 },
                { index: 1, score: 0.9 },
                { index: 2, score: 0.5 },
            ],
            prompt_tokens: 10,
            total_tokens: 10,
            elapsed_ms: 120,
        },
        {
            model: "text-embedding-3-large",
            query_vector: [0.1, 0.2],
            document_vectors: [[0.1, 0.2], [0.3, 0.4], [0.5, 0.6]],
            dim: 3072,
            scores: [
                { index: 0, score: 0.6 },
                { index: 1, score: 0.5 },
                { index: 2, score: 0.95 },
            ],
            prompt_tokens: 10,
            total_tokens: 10,
            elapsed_ms: 250,
        },
    ],
}

const oneModelResult: PlaygroundEmbeddingResult = {
    query: "solo query",
    documents: ["doc a", "doc b"],
    results: [
        {
            model: "solo-model",
            query_vector: [0.1],
            document_vectors: [[0.1], [0.2]],
            dim: 8,
            scores: [
                { index: 0, score: 0.2 },
                { index: 1, score: 0.8 },
            ],
            prompt_tokens: 4,
            total_tokens: 4,
            elapsed_ms: 50,
        },
    ],
}

describe("ResultsSection — summary line + view defaults", () => {
    it("shows the query, document count and model count", () => {
        render(<ResultsSection result={twoModelResult} />)
        expect(screen.getByText("What is the meaning of life?")).toBeInTheDocument()
        expect(screen.getByText(/3 documents/)).toBeInTheDocument()
        expect(screen.getByText(/2 models/)).toBeInTheDocument()
    })

    it("uses singular document/model wording for a count of 1", () => {
        render(<ResultsSection result={oneModelResult} />)
        expect(screen.getByText(/1 model(?!s)/)).toBeInTheDocument()
    })

    it("defaults to table view when there are 2+ model results", () => {
        render(<ResultsSection result={twoModelResult} />)
        expect(screen.getByRole("table")).toBeInTheDocument()
    })

    it("defaults to cards view when there is only 1 model result", () => {
        render(<ResultsSection result={oneModelResult} />)
        expect(screen.queryByRole("table")).not.toBeInTheDocument()
        expect(screen.getByText("solo-model")).toBeInTheDocument()
    })

    it("toggles from table to cards view and back", async () => {
        const user = userEvent.setup()
        render(<ResultsSection result={twoModelResult} />)
        expect(screen.getByRole("table")).toBeInTheDocument()

        await user.click(screen.getByRole("button", { name: /cards/i }))
        expect(screen.queryByRole("table")).not.toBeInTheDocument()
        expect(screen.getByText("text-embedding-3-small")).toBeInTheDocument()
        expect(screen.getByText("text-embedding-3-large")).toBeInTheDocument()

        await user.click(screen.getByRole("button", { name: /^table$/i }))
        expect(screen.getByRole("table")).toBeInTheDocument()
    })
})

describe("ResultsSection — ComparisonTable (table view)", () => {
    it("renders one row per document and one column per model", () => {
        render(<ResultsSection result={twoModelResult} />)
        const table = screen.getByRole("table")
        // header row + 3 doc rows
        expect(within(table).getAllByRole("row")).toHaveLength(4)
        expect(within(table).getByText("text-embedding-3-small")).toBeInTheDocument()
        expect(within(table).getByText("text-embedding-3-large")).toBeInTheDocument()
    })

    it("sorts rows by max score across models, descending, by default", () => {
        render(<ResultsSection result={twoModelResult} />)
        const table = screen.getByRole("table")
        const rows = within(table).getAllByRole("row").slice(1) // drop header
        // max per doc: doc0=0.6, doc1=0.9, doc2=0.95 -> order doc2, doc1, doc0
        expect(within(rows[0]).getByText("Life happens")).toBeInTheDocument()
        expect(within(rows[1]).getByText("42 is the answer")).toBeInTheDocument()
        expect(within(rows[2]).getByText("Pizza is life")).toBeInTheDocument()
    })

    it("switches to original input order when 'Input order' is selected", async () => {
        const user = userEvent.setup()
        render(<ResultsSection result={twoModelResult} />)
        await user.click(screen.getByRole("button", { name: /input order/i }))
        const table = screen.getByRole("table")
        const rows = within(table).getAllByRole("row").slice(1)
        expect(within(rows[0]).getByText("Pizza is life")).toBeInTheDocument()
        expect(within(rows[1]).getByText("42 is the answer")).toBeInTheDocument()
        expect(within(rows[2]).getByText("Life happens")).toBeInTheDocument()
    })

    it("highlights the per-row winning model score with a trophy", () => {
        const { container } = render(<ResultsSection result={twoModelResult} />)
        // One trophy per document row (3 docs, one winner each).
        expect(container.querySelectorAll(".lucide-trophy")).toHaveLength(3)
    })

    it("renders '—' for a document with no score from a given model", () => {
        const withMissing: PlaygroundEmbeddingResult = {
            query: "q",
            documents: ["only doc"],
            results: [
                {
                    model: "m1",
                    query_vector: [0.1],
                    document_vectors: [[0.1]],
                    dim: 4,
                    scores: [{ index: 0, score: 0.5 }],
                    prompt_tokens: 1,
                    total_tokens: 1,
                    elapsed_ms: 10,
                },
                {
                    model: "m2",
                    query_vector: null,
                    document_vectors: [null],
                    dim: null,
                    scores: null,
                    prompt_tokens: null,
                    total_tokens: null,
                    elapsed_ms: 5,
                    error: "upstream 500",
                },
            ],
        }
        render(<ResultsSection result={withMissing} />)
        const table = screen.getByRole("table")
        expect(within(table).getByText("—")).toBeInTheDocument()
    })

    it("renders a destructive error banner listing any per-model errors", () => {
        const withError: PlaygroundEmbeddingResult = {
            query: "q",
            documents: ["doc"],
            results: [
                {
                    model: "good-model",
                    query_vector: [0.1],
                    document_vectors: [[0.1]],
                    dim: 4,
                    scores: [{ index: 0, score: 0.5 }],
                    prompt_tokens: 1,
                    total_tokens: 1,
                    elapsed_ms: 10,
                },
                {
                    model: "bad-model",
                    query_vector: null,
                    document_vectors: [null],
                    dim: null,
                    scores: null,
                    prompt_tokens: null,
                    total_tokens: null,
                    elapsed_ms: 5,
                    error: "rate limited",
                },
            ],
        }
        render(<ResultsSection result={withError} />)
        expect(screen.getByText("bad-model:")).toBeInTheDocument()
        expect(screen.getByText("rate limited")).toBeInTheDocument()
    })

    it("does not render an error banner when no model result has an error", () => {
        render(<ResultsSection result={twoModelResult} />)
        expect(screen.queryByText(/rate limited|upstream/)).not.toBeInTheDocument()
    })
})

describe("ResultsSection — ModelResultCard (cards view)", () => {
    it("renders dim, tokens and elapsed_ms metadata per card", () => {
        render(<ResultsSection result={oneModelResult} />)
        expect(screen.getByText("8 dim")).toBeInTheDocument()
        expect(screen.getByText("4 tokens")).toBeInTheDocument()
        expect(screen.getByText("50ms")).toBeInTheDocument()
    })

    it("ranks scores descending by default (score sort) with a trophy on the top row", () => {
        const { container } = render(<ResultsSection result={oneModelResult} />)
        const items = screen.getAllByRole("listitem")
        // doc b (0.8) should rank above doc a (0.2).
        expect(within(items[0]).getByText("doc b")).toBeInTheDocument()
        expect(within(items[1]).getByText("doc a")).toBeInTheDocument()
        expect(container.querySelectorAll(".lucide-trophy")).toHaveLength(1)
    })

    it("switches to input-order ranking without a trophy", async () => {
        const user = userEvent.setup()
        const { container } = render(<ResultsSection result={oneModelResult} />)
        await user.click(screen.getByRole("button", { name: /input order/i }))
        const items = screen.getAllByRole("listitem")
        expect(within(items[0]).getByText("doc a")).toBeInTheDocument()
        expect(within(items[1]).getByText("doc b")).toBeInTheDocument()
        expect(container.querySelectorAll(".lucide-trophy")).toHaveLength(0)
    })

    it("shows an error badge and message for a model whose call failed", () => {
        const withError: PlaygroundEmbeddingResult = {
            query: "q",
            documents: ["doc"],
            results: [
                {
                    model: "bad-model",
                    query_vector: null,
                    document_vectors: [null],
                    dim: null,
                    scores: null,
                    prompt_tokens: null,
                    total_tokens: null,
                    elapsed_ms: 5,
                    error: "connection refused",
                },
            ],
        }
        render(<ResultsSection result={withError} />)
        expect(screen.getByText("error")).toBeInTheDocument()
        expect(screen.getByText("connection refused")).toBeInTheDocument()
    })

    it("shows 'No scores returned.' when scores is null but there is no error", () => {
        const noScores: PlaygroundEmbeddingResult = {
            query: "q",
            documents: ["doc"],
            results: [
                {
                    model: "empty-model",
                    query_vector: [0.1],
                    document_vectors: [null],
                    dim: 4,
                    scores: null,
                    prompt_tokens: 1,
                    total_tokens: 1,
                    elapsed_ms: 5,
                },
            ],
        }
        render(<ResultsSection result={noScores} />)
        expect(screen.getByText("No scores returned.")).toBeInTheDocument()
    })

    it("renders multiple cards in a grid, one per model", () => {
        render(<ResultsSection result={twoModelResult} />)
        // Force cards view.
        expect(screen.getByRole("table")).toBeInTheDocument()
    })

    it("does not show a trophy when the top score is 0 or negative", () => {
        const zeroTop: PlaygroundEmbeddingResult = {
            query: "q",
            documents: ["doc a", "doc b"],
            results: [
                {
                    model: "m1",
                    query_vector: [0.1],
                    document_vectors: [[0.1], [0.2]],
                    dim: 4,
                    scores: [
                        { index: 0, score: -0.1 },
                        { index: 1, score: -0.5 },
                    ],
                    prompt_tokens: 1,
                    total_tokens: 1,
                    elapsed_ms: 5,
                },
            ],
        }
        const { container } = render(<ResultsSection result={zeroTop} />)
        expect(container.querySelectorAll(".lucide-trophy")).toHaveLength(0)
    })
})
