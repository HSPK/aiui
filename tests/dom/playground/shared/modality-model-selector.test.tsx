import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { ModalitySingleModelSelector } from "@/components/playground/modality-model-selector"
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

describe("ModalitySingleModelSelector", () => {
    it("shows a disabled, 'Loading…' trigger while the catalog is loading", () => {
        useListMock.mockReturnValue({ data: undefined, isLoading: true })
        render(<ModalitySingleModelSelector capability="chat" value={null} onChange={vi.fn()} />)
        expect(screen.getByRole("button", { name: /loading/i })).toBeDisabled()
    })

    it("shows the placeholder when nothing is selected", () => {
        useListMock.mockReturnValue({ data: [], isLoading: false })
        render(
            <ModalitySingleModelSelector
                capability="chat"
                value={null}
                onChange={vi.fn()}
                placeholder="Choose a chat model"
            />
        )
        expect(screen.getByRole("button", { name: "Choose a chat model" })).toBeInTheDocument()
    })

    it("shows an empty state with a hint when the capability has a known heuristic", async () => {
        const user = userEvent.setup()
        useListMock.mockReturnValue({ data: [], isLoading: false })
        render(<ModalitySingleModelSelector capability="chat" value={null} onChange={vi.fn()} />)
        await user.click(screen.getByRole("button", { name: /select a model/i }))
        expect(await screen.findByText("No chat models found")).toBeInTheDocument()
        expect(
            screen.getByText("Check that your provider exposes one and that discovery succeeded.")
        ).toBeInTheDocument()
    })

    it("shows an empty state without a hint when the capability has no known heuristic", async () => {
        const user = userEvent.setup()
        useListMock.mockReturnValue({ data: [], isLoading: false })
        render(<ModalitySingleModelSelector capability="widget" value={null} onChange={vi.fn()} />)
        await user.click(screen.getByRole("button", { name: /select a model/i }))
        expect(await screen.findByText("No widget models found")).toBeInTheDocument()
        expect(
            screen.queryByText("Check that your provider exposes one and that discovery succeeded.")
        ).not.toBeInTheDocument()
    })

    it("filters the list to the requested capability via exact type match, heuristic fallback, and excludes disabled models", async () => {
        const user = userEvent.setup()
        useListMock.mockReturnValue({
            data: [
                makeModel({ id: "m1", name: "gpt-4o", type: "chat" }),
                makeModel({ id: "m2", name: "text-embedding-3-small", model_id: "text-embedding-3-small", type: "embedding" }),
                makeModel({ id: "m3", name: "claude-3-opus", model_id: "claude-3-opus", type: "unknown" }),
                makeModel({ id: "m4", name: "gpt-3.5-disabled", type: "chat", enabled: false }),
            ],
            isLoading: false,
        })
        render(<ModalitySingleModelSelector capability="chat" value={null} onChange={vi.fn()} />)
        await user.click(screen.getByRole("button", { name: /select a model/i }))

        expect(await screen.findByText("gpt-4o")).toBeInTheDocument()
        // Heuristic fallback (name matches the chat regex) picks up a
        // model whose declared `type` doesn't say "chat" — and shows a
        // badge with its real type since it differs from "chat".
        expect(screen.getByText("claude-3-opus")).toBeInTheDocument()
        expect(screen.getByText("unknown")).toBeInTheDocument()

        expect(screen.queryByText("text-embedding-3-small")).not.toBeInTheDocument()
        expect(screen.queryByText("gpt-3.5-disabled")).not.toBeInTheDocument()
    })

    it("narrows the list via the search input by name or model_id", async () => {
        const user = userEvent.setup()
        useListMock.mockReturnValue({
            data: [
                makeModel({ id: "m1", name: "gpt-4o", model_id: "gpt-4o" }),
                makeModel({ id: "m2", name: "gpt-4o-mini", model_id: "gpt-4o-mini" }),
            ],
            isLoading: false,
        })
        render(<ModalitySingleModelSelector capability="chat" value={null} onChange={vi.fn()} />)
        await user.click(screen.getByRole("button", { name: /select a model/i }))
        expect(await screen.findByText("gpt-4o")).toBeInTheDocument()
        expect(screen.getByText("gpt-4o-mini")).toBeInTheDocument()

        await user.type(screen.getByPlaceholderText("Search chat models…"), "mini")
        expect(screen.queryByText("gpt-4o")).not.toBeInTheDocument()
        expect(screen.getByText("gpt-4o-mini")).toBeInTheDocument()
    })

    it("selecting a model calls onChange with its name and closes the popover (resetting search)", async () => {
        const user = userEvent.setup()
        const onChange = vi.fn()
        useListMock.mockReturnValue({
            data: [
                makeModel({ id: "m1", name: "gpt-4o" }),
                makeModel({ id: "m2", name: "gpt-4o-mini" }),
            ],
            isLoading: false,
        })
        render(<ModalitySingleModelSelector capability="chat" value={null} onChange={onChange} />)
        await user.click(screen.getByRole("button", { name: /select a model/i }))
        await user.type(screen.getByPlaceholderText("Search chat models…"), "mini")
        await user.click(await screen.findByText("gpt-4o-mini"))

        expect(onChange).toHaveBeenCalledWith("gpt-4o-mini")
        expect(screen.queryByPlaceholderText("Search chat models…")).not.toBeInTheDocument()

        // Reopening shows the full, unfiltered list again (search reset).
        await user.click(screen.getByRole("button", { name: /select a model/i }))
        expect(await screen.findByText("gpt-4o")).toBeInTheDocument()
        expect(screen.getByText("gpt-4o-mini")).toBeInTheDocument()
    })

    it("shows the provider icon and name for a valid, non-stale selected value", () => {
        useListMock.mockReturnValue({
            data: [makeModel({ id: "m1", name: "gpt-4o", type: "chat" })],
            isLoading: false,
        })
        render(<ModalitySingleModelSelector capability="chat" value="gpt-4o" onChange={vi.fn()} />)
        const trigger = screen.getByRole("button", { name: /gpt-4o/i })
        expect(trigger).not.toHaveTextContent("(unavailable)")
        expect(trigger).not.toHaveTextContent("(missing)")
    })

    it("shows a stale '(unavailable)' state when the selected model exists but no longer satisfies the filter", () => {
        useListMock.mockReturnValue({
            data: [makeModel({ id: "m1", name: "gpt-4o", type: "chat", enabled: false })],
            isLoading: false,
        })
        render(<ModalitySingleModelSelector capability="chat" value="gpt-4o" onChange={vi.fn()} />)
        expect(screen.getByRole("button", { name: /gpt-4o.*unavailable/i })).toBeInTheDocument()
    })

    it("shows a '(missing)' state when the selected value has no matching model at all", () => {
        useListMock.mockReturnValue({
            data: [makeModel({ id: "m1", name: "gpt-4o", type: "chat" })],
            isLoading: false,
        })
        render(<ModalitySingleModelSelector capability="chat" value="deleted-model" onChange={vi.fn()} />)
        expect(screen.getByRole("button", { name: /deleted-model.*missing/i })).toBeInTheDocument()
    })

    // BUG (modality-model-selector.tsx:59-63): `selected` is computed as
    // `null` whenever `data` isn't an array yet (i.e. still loading), and
    // `stale` treats "no selected match" the same whether the catalog is
    // empty/loading OR genuinely doesn't contain the model. So a component
    // that already has a saved `value` (e.g. a conversation reopened with a
    // previously-picked model) flashes the destructive "(missing)" state on
    // every mount, before the catalog has even had a chance to load and
    // confirm the model actually exists. The fix should special-case
    // `isLoading`/`data === undefined` to keep showing "Loading…" instead of
    // asserting the model is missing.
    // While the catalog is in flight a persisted `value` is the best
    // information available, so the trigger shows the model name in neutral
    // styling. It must NOT claim the model is "(missing)" — that check can
    // only be meaningful once there is a catalog to compare against.
    it("shows a pre-set value neutrally while the catalog is still loading", () => {
        useListMock.mockReturnValue({ data: undefined, isLoading: true })
        render(<ModalitySingleModelSelector capability="chat" value="gpt-4o" onChange={vi.fn()} />)
        const trigger = screen.getByRole("button")
        expect(trigger).not.toHaveTextContent("(missing)")
        expect(trigger).toHaveTextContent("gpt-4o")
        expect(trigger.querySelector(".text-destructive")).toBeNull()
    })

    it("shows the loading indicator while the catalog loads and no value is set", () => {
        useListMock.mockReturnValue({ data: undefined, isLoading: true })
        render(<ModalitySingleModelSelector capability="chat" value="" onChange={vi.fn()} />)
        expect(screen.getByRole("button")).toHaveTextContent(/loading/i)
    })
})
