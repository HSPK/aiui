import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { ModalityMultiModelSelector } from "@/components/playground/modality-multi-model-selector"
import type { ModelDTO } from "@/lib/schemas/model"

const useListMock = vi.fn()
vi.mock("@/lib/api/models", () => ({
    models: {
        useList: (...args: unknown[]) => useListMock(...args),
    },
}))

function makeModel(overrides: Partial<ModelDTO> = {}): ModelDTO {
    return {
        id: "model_1",
        name: "gpt-4o",
        model_id: "gpt-4o",
        proxy: null,
        timeout: 30,
        max_retries: 2,
        default_params: {},
        type: "chat",
        api_variant_id: null,
        resolved_variant_id: null,
        pricing: null,
        output_dimension: null,
        context_window: null,
        max_tokens: null,
        description: null,
        knowledge_date: null,
        provider: "openai",
        provider_id: "provider_1",
        is_local: false,
        enabled: true,
        ...overrides,
    }
}

afterEach(() => {
    cleanup()
})

describe("ModalityMultiModelSelector", () => {
    it("shows 'Pick models' on the trigger when nothing is selected", () => {
        useListMock.mockReturnValue({ data: [], isLoading: false })
        render(<ModalityMultiModelSelector capability="embedding" value={[]} onChange={vi.fn()} />)
        expect(screen.getByRole("button", { name: "Pick models" })).toBeInTheDocument()
    })

    it("shows 'Loading…' on the trigger while the catalog is loading and no selection exists", () => {
        useListMock.mockReturnValue({ data: undefined, isLoading: true })
        render(<ModalityMultiModelSelector capability="embedding" value={[]} onChange={vi.fn()} />)
        expect(screen.getByRole("button", { name: /loading/i })).toBeDisabled()
    })

    it("shows the singular/plural selection count on the trigger", () => {
        useListMock.mockReturnValue({
            data: [makeModel({ id: "m1", name: "text-embedding-3-small", type: "embedding" })],
            isLoading: false,
        })
        const { rerender } = render(
            <ModalityMultiModelSelector capability="embedding" value={["text-embedding-3-small"]} onChange={vi.fn()} />
        )
        expect(screen.getByRole("button", { name: "1 model" })).toBeInTheDocument()

        rerender(
            <ModalityMultiModelSelector
                capability="embedding"
                value={["text-embedding-3-small", "text-embedding-3-large"]}
                onChange={vi.fn()}
            />
        )
        expect(screen.getByRole("button", { name: "2 models" })).toBeInTheDocument()
    })

    it("renders a removable chip per selected model", () => {
        useListMock.mockReturnValue({
            data: [makeModel({ id: "m1", name: "text-embedding-3-small", type: "embedding" })],
            isLoading: false,
        })
        render(
            <ModalityMultiModelSelector capability="embedding" value={["text-embedding-3-small"]} onChange={vi.fn()} />
        )
        expect(screen.getByText("text-embedding-3-small")).toBeInTheDocument()
        expect(screen.getByRole("button", { name: "Remove text-embedding-3-small" })).toBeInTheDocument()
    })

    it("clicking a chip's remove button calls onChange without that model", async () => {
        const user = userEvent.setup()
        const onChange = vi.fn()
        useListMock.mockReturnValue({
            data: [
                makeModel({ id: "m1", name: "model-a", type: "embedding" }),
                makeModel({ id: "m2", name: "model-b", type: "embedding" }),
            ],
            isLoading: false,
        })
        render(
            <ModalityMultiModelSelector capability="embedding" value={["model-a", "model-b"]} onChange={onChange} />
        )
        await user.click(screen.getByRole("button", { name: "Remove model-a" }))
        expect(onChange).toHaveBeenCalledWith(["model-b"])
    })

    it("selecting an unselected model in the list calls onChange with it appended", async () => {
        const user = userEvent.setup()
        const onChange = vi.fn()
        useListMock.mockReturnValue({
            data: [
                makeModel({ id: "m1", name: "model-a", type: "embedding" }),
                makeModel({ id: "m2", name: "model-b", type: "embedding" }),
            ],
            isLoading: false,
        })
        render(<ModalityMultiModelSelector capability="embedding" value={["model-a"]} onChange={onChange} />)
        await user.click(screen.getByRole("button", { name: "1 model" }))
        await user.click(await screen.findByText("model-b"))
        expect(onChange).toHaveBeenCalledWith(["model-a", "model-b"])
    })

    it("clicking an already-selected model in the list calls onChange with it removed", async () => {
        const user = userEvent.setup()
        const onChange = vi.fn()
        useListMock.mockReturnValue({
            data: [
                makeModel({ id: "m1", name: "model-a", type: "embedding" }),
                makeModel({ id: "m2", name: "model-b", type: "embedding" }),
            ],
            isLoading: false,
        })
        render(
            <ModalityMultiModelSelector capability="embedding" value={["model-a", "model-b"]} onChange={onChange} />
        )
        await user.click(screen.getByRole("button", { name: "2 models" }))
        await screen.findByPlaceholderText("Search embedding models…")
        // Scope to the popover content so we click the list row, not the chip.
        const popover = document.querySelector('[data-slot="popover-content"]') as HTMLElement
        const listRow = within(popover).getByText("model-a").closest("button")!
        await user.click(listRow)
        expect(onChange).toHaveBeenCalledWith(["model-b"])
    })

    it("disables further additions once maxModels is reached and shows the limit hint", async () => {
        const user = userEvent.setup()
        const onChange = vi.fn()
        useListMock.mockReturnValue({
            data: [
                makeModel({ id: "m1", name: "model-a", type: "embedding" }),
                makeModel({ id: "m2", name: "model-b", type: "embedding" }),
            ],
            isLoading: false,
        })
        render(
            <ModalityMultiModelSelector
                capability="embedding"
                value={["model-a"]}
                onChange={onChange}
                maxModels={1}
            />
        )
        await user.click(screen.getByRole("button", { name: "1 model" }))
        expect(await screen.findByText("Max 1 models. Remove one to add more.")).toBeInTheDocument()

        const modelBRow = screen.getByText("model-b").closest("button")!
        expect(modelBRow).toBeDisabled()
        await user.click(modelBRow)
        expect(onChange).not.toHaveBeenCalled()
    })

    it("shows a stale 'missing' chip when the value has no matching model in the catalog", () => {
        useListMock.mockReturnValue({ data: [], isLoading: false })
        render(<ModalityMultiModelSelector capability="embedding" value={["deleted-model"]} onChange={vi.fn()} />)
        const chip = screen.getByText("deleted-model").closest('[title]')
        expect(chip).toHaveAttribute("title", "deleted-model (missing)")
    })

    it("shows a stale 'unavailable' chip when the model exists but no longer satisfies the filter", () => {
        useListMock.mockReturnValue({
            data: [makeModel({ id: "m1", name: "model-a", type: "embedding", enabled: false })],
            isLoading: false,
        })
        render(<ModalityMultiModelSelector capability="embedding" value={["model-a"]} onChange={vi.fn()} />)
        const chip = screen.getByText("model-a").closest('[title]')
        expect(chip).toHaveAttribute("title", "model-a (unavailable)")
    })

    it("narrows the popover list via the search input", async () => {
        const user = userEvent.setup()
        useListMock.mockReturnValue({
            data: [
                makeModel({ id: "m1", name: "text-embedding-3-small", type: "embedding" }),
                makeModel({ id: "m2", name: "text-embedding-3-large", type: "embedding" }),
            ],
            isLoading: false,
        })
        render(<ModalityMultiModelSelector capability="embedding" value={[]} onChange={vi.fn()} />)
        await user.click(screen.getByRole("button", { name: "Pick models" }))
        expect(await screen.findByText("text-embedding-3-small")).toBeInTheDocument()
        expect(screen.getByText("text-embedding-3-large")).toBeInTheDocument()

        await user.type(screen.getByPlaceholderText("Search embedding models…"), "large")
        expect(screen.queryByText("text-embedding-3-small")).not.toBeInTheDocument()
        expect(screen.getByText("text-embedding-3-large")).toBeInTheDocument()
    })
})
