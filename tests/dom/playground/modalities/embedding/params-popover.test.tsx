import * as React from "react"
import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import {
    ParamsPopover,
    paramsToWire,
    countActive,
} from "@/components/playground/embedding/params-popover"
import type { PlaygroundEmbeddingParams } from "@/lib/schemas/playground"

afterEach(() => {
    cleanup()
})

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("paramsToWire", () => {
    it("returns undefined for an empty params object", () => {
        expect(paramsToWire({})).toBeUndefined()
    })

    it("includes dimensions when set, even when 0 (uses != null, not truthiness)", () => {
        expect(paramsToWire({ dimensions: 0 })).toEqual({ dimensions: 0 })
    })

    it("includes a positive dimensions value", () => {
        expect(paramsToWire({ dimensions: 256 })).toEqual({ dimensions: 256 })
    })

    it("includes encoding_format when set", () => {
        expect(paramsToWire({ encoding_format: "base64" })).toEqual({ encoding_format: "base64" })
    })

    it("includes input_type when set", () => {
        expect(paramsToWire({ input_type: "search_query" })).toEqual({ input_type: "search_query" })
    })

    it("omits input_type when it is an empty string (falsy check)", () => {
        expect(paramsToWire({ input_type: "" })).toBeUndefined()
    })

    it("includes user when set", () => {
        expect(paramsToWire({ user: "user-123" })).toEqual({ user: "user-123" })
    })

    it("omits user when it is an empty string", () => {
        expect(paramsToWire({ user: "" })).toBeUndefined()
    })

    it("combines all four fields when set", () => {
        const p: PlaygroundEmbeddingParams = {
            dimensions: 512,
            encoding_format: "float",
            input_type: "search_document",
            user: "abc",
        }
        expect(paramsToWire(p)).toEqual(p)
    })

    it("ignores unset optional fields, only returning set ones", () => {
        expect(paramsToWire({ dimensions: 10 })).toEqual({ dimensions: 10 })
    })
})

describe("countActive", () => {
    it("returns 0 for an empty params object", () => {
        expect(countActive({})).toBe(0)
    })

    it("counts dimensions even when 0", () => {
        expect(countActive({ dimensions: 0 })).toBe(1)
    })

    it("does not count an empty-string input_type or user", () => {
        expect(countActive({ input_type: "", user: "" })).toBe(0)
    })

    it("counts all four fields when set", () => {
        expect(
            countActive({
                dimensions: 5,
                encoding_format: "float",
                input_type: "search_query",
                user: "abc",
            }),
        ).toBe(4)
    })

    it("counts a partial combination correctly", () => {
        expect(countActive({ dimensions: 5, user: "abc" })).toBe(2)
    })
})

// ---------------------------------------------------------------------------
// <ParamsPopover /> component
// ---------------------------------------------------------------------------

/** Stateful wrapper so controlled-input interactions (typing, select,
 *  reset) reflect back into `value` across renders, the same way the
 *  real embedding-playground <-> zustand store wiring behaves. */
function Harness({ initial = {} }: { initial?: PlaygroundEmbeddingParams }) {
    const [value, setValue] = React.useState<PlaygroundEmbeddingParams>(initial)
    return <ParamsPopover value={value} onChange={setValue} />
}

async function openPopover(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: /params/i }))
}

/** Row label + hint live in an inner flex div; the actual field control
 *  is a sibling of that inner div, one level up. */
function rowContainer(labelText: string): HTMLElement {
    return screen.getByText(labelText).closest("div")!.parentElement as HTMLElement
}

describe("ParamsPopover", () => {
    it("renders the trigger without a count badge when no params are active", () => {
        render(<ParamsPopover value={{}} onChange={vi.fn()} />)
        const button = screen.getByRole("button", { name: /params/i })
        expect(button).toBeInTheDocument()
        expect(within(button).queryByText(/^\d+$/)).not.toBeInTheDocument()
    })

    it("renders a count badge reflecting the number of active params", () => {
        render(
            <ParamsPopover
                value={{ dimensions: 256, user: "u1" }}
                onChange={vi.fn()}
            />,
        )
        expect(screen.getByText("2")).toBeInTheDocument()
    })

    it("does not render a Reset button when no params are active", async () => {
        const user = userEvent.setup()
        render(<ParamsPopover value={{}} onChange={vi.fn()} />)
        await openPopover(user)
        expect(screen.queryByRole("button", { name: /reset/i })).not.toBeInTheDocument()
    })

    it("typing a dimensions value merges into the params and updates the active count", async () => {
        // Uses the stateful Harness (not a bare onChange spy) because the
        // underlying <Input> is controlled: without re-rendering `value`
        // between keystrokes React resets the DOM value after every
        // keypress, so only the final keystroke would "stick" with a
        // fixed-prop render.
        const user = userEvent.setup()
        render(<Harness initial={{ user: "u1" }} />)
        await openPopover(user)
        const dimInput = screen.getByRole("spinbutton")
        await user.clear(dimInput)
        await user.type(dimInput, "512")
        expect(dimInput).toHaveValue(512)
        expect(screen.getByText("2")).toBeInTheDocument()
    })

    it("clamps a dimensions value below 1 up to 1", async () => {
        const user = userEvent.setup()
        const onChange = vi.fn()
        render(<ParamsPopover value={{}} onChange={onChange} />)
        await openPopover(user)
        const dimInput = screen.getByRole("spinbutton")
        await user.type(dimInput, "-5")
        expect(onChange).toHaveBeenLastCalledWith({ dimensions: 1 })
    })

    it("clearing the dimensions field sets it to undefined", async () => {
        const user = userEvent.setup()
        const onChange = vi.fn()
        render(<ParamsPopover value={{ dimensions: 10 }} onChange={onChange} />)
        await openPopover(user)
        const dimInput = screen.getByRole("spinbutton")
        await user.clear(dimInput)
        expect(onChange).toHaveBeenLastCalledWith({ dimensions: undefined })
    })

    it("selecting an encoding format calls onChange with the new value", async () => {
        const user = userEvent.setup()
        const onChange = vi.fn()
        render(<ParamsPopover value={{}} onChange={onChange} />)
        await openPopover(user)
        await user.click(screen.getByRole("combobox"))
        await user.click(await screen.findByRole("option", { name: "base64" }))
        expect(onChange).toHaveBeenLastCalledWith({ encoding_format: "base64" })
    })

    it("selecting 'Default' for encoding format clears it back to undefined", async () => {
        const user = userEvent.setup()
        const onChange = vi.fn()
        render(<ParamsPopover value={{ encoding_format: "float" }} onChange={onChange} />)
        await openPopover(user)
        await user.click(screen.getByRole("combobox"))
        await user.click(await screen.findByRole("option", { name: "Default" }))
        expect(onChange).toHaveBeenLastCalledWith({ encoding_format: undefined })
    })

    it("typing an input_type value merges into the params", async () => {
        const user = userEvent.setup()
        render(<Harness />)
        await openPopover(user)
        const input = within(rowContainer("Input type")).getByRole("textbox")
        await user.type(input, "search_query")
        expect(input).toHaveValue("search_query")
        expect(screen.getByText("1")).toBeInTheDocument()
    })

    it("typing a user id merges into the params", async () => {
        const user = userEvent.setup()
        render(<Harness />)
        await openPopover(user)
        const input = screen.getByPlaceholderText("—")
        await user.type(input, "u-42")
        expect(input).toHaveValue("u-42")
        expect(screen.getByText("1")).toBeInTheDocument()
    })

    it("Reset button clears all params back to {} and disappears once inactive", async () => {
        const user = userEvent.setup()
        render(<Harness initial={{ dimensions: 99, user: "u1", input_type: "x", encoding_format: "float" }} />)
        await openPopover(user)
        expect(screen.getByText("4")).toBeInTheDocument()
        await user.click(screen.getByRole("button", { name: /reset/i }))
        // Popover re-renders with the fresh {} value: badge + Reset both gone.
        expect(screen.queryByText("4")).not.toBeInTheDocument()
        expect(screen.queryByRole("button", { name: /reset/i })).not.toBeInTheDocument()
    })

    it("shows hint text for each param row", async () => {
        const user = userEvent.setup()
        render(<ParamsPopover value={{}} onChange={vi.fn()} />)
        await openPopover(user)
        expect(screen.getByText(/Truncate vector length/)).toBeInTheDocument()
        expect(screen.getByText(/float \| base64/)).toBeInTheDocument()
        expect(screen.getByText(/Cohere \/ voyage/)).toBeInTheDocument()
        expect(screen.getByText(/Opaque user id forwarded upstream/)).toBeInTheDocument()
    })
})
