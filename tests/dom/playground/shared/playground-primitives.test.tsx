import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { Bot } from "lucide-react"

import { PromptChips, EmptyHint, SkeletonGrid } from "@/components/playground/_parts/playground-primitives"

describe("PromptChips", () => {
    it("renders nothing when examples is empty", () => {
        const { container } = render(<PromptChips examples={[]} onPick={vi.fn()} />)
        expect(container.firstChild).toBeNull()
    })

    it("renders the default label and one button per example", () => {
        render(<PromptChips examples={["Write a haiku", "Summarize this"]} onPick={vi.fn()} />)
        expect(screen.getByText("Try")).toBeInTheDocument()
        expect(screen.getByRole("button", { name: "Write a haiku" })).toBeInTheDocument()
        expect(screen.getByRole("button", { name: "Summarize this" })).toBeInTheDocument()
    })

    it("renders a custom label when provided", () => {
        render(<PromptChips examples={["Example"]} onPick={vi.fn()} label="Examples" />)
        expect(screen.getByText("Examples")).toBeInTheDocument()
        expect(screen.queryByText("Try")).not.toBeInTheDocument()
    })

    it("calls onPick with the example text when a chip is clicked", async () => {
        const user = userEvent.setup()
        const onPick = vi.fn()
        render(<PromptChips examples={["Write a haiku", "Summarize this"]} onPick={onPick} />)
        await user.click(screen.getByRole("button", { name: "Summarize this" }))
        expect(onPick).toHaveBeenCalledTimes(1)
        expect(onPick).toHaveBeenCalledWith("Summarize this")
    })

    it("sets the title attribute to the full example text (truncation affordance)", () => {
        render(<PromptChips examples={["A very long example prompt"]} onPick={vi.fn()} />)
        expect(screen.getByRole("button", { name: "A very long example prompt" })).toHaveAttribute(
            "title",
            "A very long example prompt",
        )
    })
})

describe("EmptyHint", () => {
    it("renders the title and icon", () => {
        const { container } = render(<EmptyHint icon={Bot} title="Nothing yet" />)
        expect(screen.getByText("Nothing yet")).toBeInTheDocument()
        expect(container.querySelector("svg")).toBeInTheDocument()
    })

    it("renders the description when provided, and omits it when absent", () => {
        const { rerender } = render(<EmptyHint icon={Bot} title="Nothing yet" description="Try generating something" />)
        expect(screen.getByText("Try generating something")).toBeInTheDocument()

        rerender(<EmptyHint icon={Bot} title="Nothing yet" />)
        expect(screen.queryByText("Try generating something")).not.toBeInTheDocument()
    })

    it("renders children when provided, and omits the children wrapper when absent", () => {
        const { container, rerender } = render(
            <EmptyHint icon={Bot} title="Nothing yet">
                <button type="button">Retry</button>
            </EmptyHint>,
        )
        expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument()

        rerender(<EmptyHint icon={Bot} title="Nothing yet" />)
        expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument()
        // No leftover empty children wrapper div beyond the icon/title/description block.
        expect(container.querySelectorAll("div").length).toBe(1)
    })
})

describe("SkeletonGrid", () => {
    it("renders `count` placeholder tiles", () => {
        const { container } = render(<SkeletonGrid count={5} />)
        expect(container.firstChild?.childNodes).toHaveLength(5)
    })

    it("renders zero tiles for count=0", () => {
        const { container } = render(<SkeletonGrid count={0} />)
        expect(container.firstChild?.childNodes).toHaveLength(0)
    })

    it.each([
        [1, "grid-cols-1"],
        [2, "grid-cols-1"],
        [3, "grid-cols-2"],
    ] as const)("applies the expected grid class for cols=%s", (cols, expectedClass) => {
        const { container } = render(<SkeletonGrid count={2} cols={cols} />)
        expect((container.firstChild as HTMLElement).className).toContain(expectedClass)
    })

    it("defaults to the 3-column grid class when cols is omitted", () => {
        const { container } = render(<SkeletonGrid count={2} />)
        expect((container.firstChild as HTMLElement).className).toContain("lg:grid-cols-3")
    })
})
