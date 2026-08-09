import * as React from "react"
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest"
import { screen, within, waitFor, fireEvent, act } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { EmbeddingPlayground } from "@/components/playground/embedding/embedding-playground"
import { useModalityStore } from "@/lib/stores/modality-store"
import { gateway } from "@/lib/api/gateway"
import { ApiError } from "@/lib/api/client"
import { toast } from "sonner"
import { renderWithClient, resetModalityStore } from "../../_render"
import { makeModel } from "../_fixtures"
import type { PlaygroundEmbeddingResult } from "@/lib/schemas/playground"

vi.mock("@/lib/api/gateway", () => ({
    gateway: {
        playgroundEmbedding: vi.fn(),
    },
}))

vi.mock("sonner", () => ({
    toast: { success: vi.fn(), error: vi.fn() },
}))

const useListMock = vi.fn()
vi.mock("@/lib/api/models", () => ({
    models: {
        useList: (...args: unknown[]) => useListMock(...args),
    },
}))

const EMBEDDING_MODELS = [
    makeModel({ id: "m1", name: "text-embedding-3-small", model_id: "text-embedding-3-small", type: "embedding" }),
    makeModel({ id: "m2", name: "text-embedding-3-large", model_id: "text-embedding-3-large", type: "embedding" }),
]

function resultFixture(): PlaygroundEmbeddingResult {
    return {
        query: "q",
        documents: ["doc1", "doc2"],
        results: [
            {
                model: "text-embedding-3-small",
                query_vector: [0.1, 0.2],
                document_vectors: [[0.1, 0.2], [0.3, 0.4]],
                dim: 1536,
                scores: [
                    { index: 0, score: 0.5 },
                    { index: 1, score: 0.9 },
                ],
                prompt_tokens: 4,
                total_tokens: 4,
                elapsed_ms: 42,
            },
        ],
    }
}

beforeEach(() => {
    useListMock.mockReturnValue({ data: EMBEDDING_MODELS, isLoading: false })
})

afterEach(() => {
    resetModalityStore()
})

describe("EmbeddingPlayground — empty state", () => {
    it("shows a generic empty hint before any model is picked", () => {
        renderWithClient(<EmbeddingPlayground />)
        expect(screen.getByText("Pick one or more embedding models to compare.")).toBeInTheDocument()
    })

    it("switches to the batched-call hint once at least one model is selected", () => {
        useModalityStore.getState().patchEmbedding({ modelIds: ["text-embedding-3-small"] })
        renderWithClient(<EmbeddingPlayground />)
        expect(
            screen.getByText(/Each model embeds the query and every document in one batched call/),
        ).toBeInTheDocument()
    })

    it("'Load an example query' seeds the query and documents", async () => {
        const user = userEvent.setup()
        renderWithClient(<EmbeddingPlayground />)
        await user.click(screen.getByRole("button", { name: /load an example query/i }))
        expect(screen.getByDisplayValue("What is the meaning of life?")).toBeInTheDocument()
        expect(screen.getByText("(5/64 lines)")).toBeInTheDocument()
    })

    it("typing directly into the Query input and Documents textarea updates their values", async () => {
        const user = userEvent.setup()
        const { container } = renderWithClient(<EmbeddingPlayground />)
        await user.type(screen.getByLabelText(/A — Query/), "hello world")
        expect(screen.getByDisplayValue("hello world")).toBeInTheDocument()

        const textarea = container.querySelector("#embed-docs") as HTMLTextAreaElement
        fireEvent.change(textarea, { target: { value: "doc one\ndoc two" } })
        expect(textarea.value).toBe("doc one\ndoc two")
        expect(screen.getByText("(2/64 lines)")).toBeInTheDocument()
    })
})

describe("EmbeddingPlayground — multi-model selector integration", () => {
    it("picking models updates the header chip count and the Run label", async () => {
        const user = userEvent.setup()
        renderWithClient(<EmbeddingPlayground />)
        expect(screen.getByText(/Run · — models/)).toBeInTheDocument()

        await user.click(screen.getByRole("button", { name: /pick models/i }))
        await user.click(await screen.findByText("text-embedding-3-small"))
        expect(screen.getByText(/Run · 1 model(?!s)/)).toBeInTheDocument()

        // The multi-select popover stays open after picking a model (unlike
        // the single-model selector, which closes) — no need to reopen it.
        await user.click(await screen.findByText("text-embedding-3-large"))
        expect(screen.getByText(/Run · 2 models/)).toBeInTheDocument()
    })
})

describe("EmbeddingPlayground — document parsing (dedup / truncation)", () => {
    it("deduplicates repeated document lines while preserving order", () => {
        useModalityStore.getState().patchEmbedding({ docsText: "a\na\nb\n\n  \nb" })
        renderWithClient(<EmbeddingPlayground />)
        expect(screen.getByText("(2/64 lines)")).toBeInTheDocument()
    })

    it("truncates to the first 64 unique lines and shows a warning with the real drop count", () => {
        const lines = Array.from({ length: 70 }, (_, i) => `doc-${i}`).join("\n")
        useModalityStore.getState().patchEmbedding({ docsText: lines })
        renderWithClient(<EmbeddingPlayground />)
        expect(screen.getByText("(64/64 lines)")).toBeInTheDocument()
        expect(
            screen.getByText("Only the first 64 of 70 non-empty lines will be sent"),
        ).toBeInTheDocument()
    })

    it("sends only the first 64 documents to the gateway when truncated", async () => {
        const user = userEvent.setup()
        const lines = Array.from({ length: 70 }, (_, i) => `doc-${i}`).join("\n")
        useModalityStore.getState().patchEmbedding({
            modelIds: ["text-embedding-3-small"],
            query: "q",
            docsText: lines,
        })
        vi.mocked(gateway.playgroundEmbedding).mockResolvedValue(resultFixture())
        renderWithClient(<EmbeddingPlayground />)
        await user.click(screen.getByRole("button", { name: /^run/i }))
        await waitFor(() => expect(gateway.playgroundEmbedding).toHaveBeenCalledTimes(1))
        const call = vi.mocked(gateway.playgroundEmbedding).mock.calls[0][0]
        expect(call.documents).toHaveLength(64)
        expect(call.documents[0]).toBe("doc-0")
        expect(call.documents[63]).toBe("doc-63")
    })
})

describe("EmbeddingPlayground — validation toasts (⌘/Ctrl+Enter shortcut bypasses the disabled button)", () => {
    it("toasts when no model is picked", () => {
        useModalityStore.getState().patchEmbedding({ query: "q", docsText: "doc1" })
        renderWithClient(<EmbeddingPlayground />)
        fireEvent.keyDown(screen.getByLabelText(/A — Query/), { key: "Enter", ctrlKey: true })
        expect(toast.error).toHaveBeenCalledWith("Pick at least one embedding model")
    })

    it("toasts when the query is empty", () => {
        useModalityStore.getState().patchEmbedding({ modelIds: ["text-embedding-3-small"], docsText: "doc1" })
        renderWithClient(<EmbeddingPlayground />)
        fireEvent.keyDown(screen.getByLabelText(/A — Query/), { key: "Enter", ctrlKey: true })
        expect(toast.error).toHaveBeenCalledWith("Query (A) is required")
    })

    it("toasts when the query is only whitespace", () => {
        useModalityStore.getState().patchEmbedding({
            modelIds: ["text-embedding-3-small"],
            query: "   ",
            docsText: "doc1",
        })
        renderWithClient(<EmbeddingPlayground />)
        fireEvent.keyDown(screen.getByLabelText(/A — Query/), { key: "Enter", ctrlKey: true })
        expect(toast.error).toHaveBeenCalledWith("Query (A) is required")
    })

    it("toasts when there are no documents", () => {
        useModalityStore.getState().patchEmbedding({ modelIds: ["text-embedding-3-small"], query: "q" })
        renderWithClient(<EmbeddingPlayground />)
        fireEvent.keyDown(screen.getByLabelText(/A — Query/), { key: "Enter", ctrlKey: true })
        expect(toast.error).toHaveBeenCalledWith("Add at least one document line in B")
    })

    it("does not call the gateway for any invalid combination", () => {
        useModalityStore.getState().patchEmbedding({ query: "q" })
        renderWithClient(<EmbeddingPlayground />)
        fireEvent.keyDown(screen.getByLabelText(/A — Query/), { key: "Enter", ctrlKey: true })
        expect(gateway.playgroundEmbedding).not.toHaveBeenCalled()
    })
})

describe("EmbeddingPlayground — submit flow", () => {
    function primeValid() {
        useModalityStore.getState().patchEmbedding({
            modelIds: ["text-embedding-3-small"],
            query: "What is the meaning of life?",
            docsText: "doc1\ndoc2",
        })
    }

    it("calls gateway.playgroundEmbedding with trimmed query, docs and wire params, then renders the result", async () => {
        const user = userEvent.setup()
        primeValid()
        vi.mocked(gateway.playgroundEmbedding).mockResolvedValue(resultFixture())
        renderWithClient(<EmbeddingPlayground />)

        await user.click(screen.getByRole("button", { name: /^run/i }))

        await waitFor(() =>
            expect(gateway.playgroundEmbedding).toHaveBeenCalledWith({
                models: ["text-embedding-3-small"],
                query: "What is the meaning of life?",
                documents: ["doc1", "doc2"],
                params: undefined,
            }),
        )
        expect(await screen.findByText(/2 documents/)).toBeInTheDocument()
    })

    it("shows a disabled, running submit button while the request is in flight", async () => {
        const user = userEvent.setup()
        primeValid()
        let resolvePromise!: (v: PlaygroundEmbeddingResult) => void
        vi.mocked(gateway.playgroundEmbedding).mockImplementation(
            () => new Promise((resolve) => { resolvePromise = resolve }),
        )
        renderWithClient(<EmbeddingPlayground />)

        await user.click(screen.getByRole("button", { name: /^run/i }))
        const runningButton = await screen.findByRole("button", { name: /embedding…/i })
        expect(runningButton).toBeDisabled()

        await act(async () => {
            resolvePromise(resultFixture())
        })
        expect(await screen.findByText(/2 documents/)).toBeInTheDocument()
    })

    it("shows an ApiError message via toast.error and an error card on failure", async () => {
        const user = userEvent.setup()
        primeValid()
        vi.mocked(gateway.playgroundEmbedding).mockRejectedValue(new ApiError("boom upstream", 502))
        renderWithClient(<EmbeddingPlayground />)

        await user.click(screen.getByRole("button", { name: /^run/i }))

        expect(await screen.findByText("boom upstream")).toBeInTheDocument()
        expect(toast.error).toHaveBeenCalledWith("boom upstream")
    })

    it("stringifies a non-Error rejection", async () => {
        const user = userEvent.setup()
        primeValid()
        vi.mocked(gateway.playgroundEmbedding).mockRejectedValue("plain string failure")
        renderWithClient(<EmbeddingPlayground />)

        await user.click(screen.getByRole("button", { name: /^run/i }))

        expect(await screen.findByText("plain string failure")).toBeInTheDocument()
    })

    it("shows a plain Error's message (not just ApiError/string rejections)", async () => {
        const user = userEvent.setup()
        primeValid()
        vi.mocked(gateway.playgroundEmbedding).mockRejectedValue(new Error("network exploded"))
        renderWithClient(<EmbeddingPlayground />)

        await user.click(screen.getByRole("button", { name: /^run/i }))

        expect(await screen.findByText("network exploded")).toBeInTheDocument()
        expect(toast.error).toHaveBeenCalledWith("network exploded")
    })

    it("clears a stale error after a subsequent successful submission (does not linger)", async () => {
        const user = userEvent.setup()
        primeValid()
        vi.mocked(gateway.playgroundEmbedding).mockRejectedValueOnce(new ApiError("first failure", 500))
        renderWithClient(<EmbeddingPlayground />)

        await user.click(screen.getByRole("button", { name: /^run/i }))
        expect(await screen.findByText("first failure")).toBeInTheDocument()

        vi.mocked(gateway.playgroundEmbedding).mockResolvedValueOnce(resultFixture())
        await user.click(screen.getByRole("button", { name: /^run/i }))

        await waitFor(() => expect(screen.queryByText("first failure")).not.toBeInTheDocument())
        expect(await screen.findByText(/2 documents/)).toBeInTheDocument()
    })
})

describe("EmbeddingPlayground — params popover wiring", () => {
    it("forwards active params to the gateway call as wire params", async () => {
        const user = userEvent.setup()
        useModalityStore.getState().patchEmbedding({
            modelIds: ["text-embedding-3-small"],
            query: "q",
            docsText: "doc1",
        })
        vi.mocked(gateway.playgroundEmbedding).mockResolvedValue(resultFixture())
        renderWithClient(<EmbeddingPlayground />)

        await user.click(screen.getByRole("button", { name: /params/i }))
        const dimInput = screen.getByRole("spinbutton")
        await user.clear(dimInput)
        await user.type(dimInput, "256")

        await user.click(screen.getByRole("button", { name: /^run/i }))
        await waitFor(() =>
            expect(gateway.playgroundEmbedding).toHaveBeenCalledWith(
                expect.objectContaining({ params: { dimensions: 256 } }),
            ),
        )
    })
})
