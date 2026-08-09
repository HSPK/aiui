import { describe, it, expect } from "vitest"
import { render, screen, within, cleanup } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach } from "vitest"

import { ToolCallsList } from "@/components/playground/tool-calls-list"
import type { AssembledToolCall } from "@/components/playground/chat/types"

function makeCall(overrides: Partial<AssembledToolCall> = {}): AssembledToolCall {
    return {
        id: "call_1",
        name: "search_issues",
        arguments: JSON.stringify({ q: "bug" }),
        ...overrides,
    }
}

afterEach(() => {
    cleanup()
})

describe("ToolCallsList", () => {
    it("renders an empty-state header when there are no calls", () => {
        render(<ToolCallsList calls={[]} />)
        expect(screen.getByText("0 tool calls")).toBeInTheDocument()
        expect(screen.getByText("empty")).toBeInTheDocument()
    })

    it("uses singular wording for exactly one call", () => {
        render(<ToolCallsList calls={[makeCall()]} />)
        expect(screen.getByText("1 tool call")).toBeInTheDocument()
        expect(screen.queryByText("1 tool calls")).not.toBeInTheDocument()
    })

    it("auto-expands the row list when calls.length <= 3", () => {
        render(<ToolCallsList calls={[makeCall({ id: "a" }), makeCall({ id: "b", name: "second_tool" })]} />)
        // Rows are visible without needing to click the header.
        expect(screen.getByText("search_issues")).toBeInTheDocument()
        expect(screen.getByText("second_tool")).toBeInTheDocument()
    })

    it("starts collapsed when calls.length > 3, and the header toggles the row list", async () => {
        const user = userEvent.setup()
        const calls = [1, 2, 3, 4].map((n) => makeCall({ id: `c${n}`, name: `tool_${n}` }))
        render(<ToolCallsList calls={calls} />)

        expect(screen.queryByText("tool_1")).not.toBeInTheDocument()
        expect(screen.getByText("4 tool calls")).toBeInTheDocument()

        await user.click(screen.getByRole("button", { name: /4 tool calls/i }))
        expect(screen.getByText("tool_1")).toBeInTheDocument()
        expect(screen.getByText("tool_4")).toBeInTheDocument()

        await user.click(screen.getByRole("button", { name: /4 tool calls/i }))
        expect(screen.queryByText("tool_1")).not.toBeInTheDocument()
    })

    it("shows a 'running' pill and no error badge for a call with no result yet", () => {
        render(<ToolCallsList calls={[makeCall({ result: undefined })]} />)
        expect(screen.getByText(/1 running/)).toBeInTheDocument()
        expect(screen.queryByText("err")).not.toBeInTheDocument()
    })

    it("expanding a successful call reveals Arguments and Result, collapsed hides them", async () => {
        const user = userEvent.setup()
        render(
            <ToolCallsList
                calls={[
                    makeCall({
                        arguments: JSON.stringify({ q: "bug" }),
                        result: { content: "found 3 issues", is_error: false },
                    }),
                ]}
            />,
        )
        expect(screen.getByText(/1 ok/)).toBeInTheDocument()
        expect(screen.queryByText("Arguments")).not.toBeInTheDocument()
        expect(screen.queryByText("found 3 issues")).not.toBeInTheDocument()

        await user.click(screen.getByRole("button", { name: /search_issues/i }))
        expect(screen.getByText("Arguments")).toBeInTheDocument()
        expect(screen.getByText(/"q": "bug"/)).toBeInTheDocument()
        expect(screen.getByText("Result")).toBeInTheDocument()
        expect(screen.getByText("found 3 issues")).toBeInTheDocument()

        await user.click(screen.getByRole("button", { name: /search_issues/i }))
        expect(screen.queryByText("found 3 issues")).not.toBeInTheDocument()
    })

    it("shows the 'err' badge (always visible) and 'Result (error)' label (once expanded) for an error result", async () => {
        const user = userEvent.setup()
        render(
            <ToolCallsList
                calls={[makeCall({ result: { content: "boom: rate limited", is_error: true } })]}
            />,
        )
        // Badge is visible without expanding the row.
        expect(screen.getByText("err")).toBeInTheDocument()
        expect(screen.getByText(/1 error/)).toBeInTheDocument()

        await user.click(screen.getByRole("button", { name: /search_issues/i }))
        expect(screen.getByText("Result (error)")).toBeInTheDocument()
        expect(screen.getByText("boom: rate limited")).toBeInTheDocument()
    })

    it("pluralizes the error stat pill correctly for more than one error", () => {
        render(
            <ToolCallsList
                calls={[
                    makeCall({ id: "a", result: { content: "e1", is_error: true } }),
                    makeCall({ id: "b", name: "other_tool", result: { content: "e2", is_error: true } }),
                ]}
            />,
        )
        expect(screen.getByText(/2 errors/)).toBeInTheDocument()
    })

    it("renders multiple calls in the given order", () => {
        render(
            <ToolCallsList
                calls={[
                    makeCall({ id: "a", name: "first_tool" }),
                    makeCall({ id: "b", name: "second_tool" }),
                    makeCall({ id: "c", name: "third_tool" }),
                ]}
            />,
        )
        const items = screen.getAllByRole("listitem")
        expect(items).toHaveLength(3)
        expect(within(items[0]).getByText("first_tool")).toBeInTheDocument()
        expect(within(items[1]).getByText("second_tool")).toBeInTheDocument()
        expect(within(items[2]).getByText("third_tool")).toBeInTheDocument()
    })

    it("gracefully degrades to the raw string when arguments is malformed JSON (no crash)", async () => {
        const user = userEvent.setup()
        render(<ToolCallsList calls={[makeCall({ arguments: "{not valid json" })]} />)
        await user.click(screen.getByRole("button", { name: /search_issues/i }))
        expect(screen.getByText("{not valid json")).toBeInTheDocument()
    })

    it("falls back to '{}' when arguments is an empty string", async () => {
        const user = userEvent.setup()
        render(<ToolCallsList calls={[makeCall({ arguments: "" })]} />)
        await user.click(screen.getByRole("button", { name: /search_issues/i }))
        expect(screen.getByText("{}")).toBeInTheDocument()
    })

    it("prefixes the call name with its source when present, and omits the slash when absent", () => {
        const { rerender } = render(
            <ToolCallsList calls={[makeCall({ source: "github", name: "search_issues" })]} />,
        )
        expect(screen.getByText("github/")).toBeInTheDocument()
        expect(screen.getByText("search_issues")).toBeInTheDocument()

        rerender(<ToolCallsList calls={[makeCall({ source: undefined, name: "search_issues" })]} />)
        expect(screen.queryByText("github/")).not.toBeInTheDocument()
        expect(screen.getByText("search_issues")).toBeInTheDocument()
    })
})
