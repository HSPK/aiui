import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, cleanup, act, waitFor } from "@testing-library/react"

import { CodeBlock, InlineCode } from "@/components/playground/code-block"
import { flushAsync } from "../_render"

const useThemeMock = vi.fn(() => ({ theme: "dark", resolvedTheme: "dark" }))
vi.mock("next-themes", () => ({ useTheme: () => useThemeMock() }))

vi.mock("@/lib/clipboard", () => ({ copyToClipboard: vi.fn() }))
import { copyToClipboard } from "@/lib/clipboard"

// `next/dynamic` lazy-loads the real (large, async) `react-syntax-highlighter`
// package. The component's own logic (header, copy button, language
// normalization, dark/light styling) doesn't depend on the highlighter
// actually rendering colourised tokens — that's react-syntax-highlighter's
// own concern, not ours — so we stub it with a synchronous passthrough to
// keep these tests fast and immune to real-package-load timing.
vi.mock("next/dynamic", () => ({
    default: () =>
        function MockSyntaxHighlighter(props: any) {
            return <pre data-testid="mock-syntax-highlighter">{props.children}</pre>
        },
}))

/** Lets the async `customTheme` effect (a real dynamic import of the Prism
 *  style module) settle before we assert, avoiding act() warnings. None of
 *  our assertions actually depend on which branch (raw <pre> fallback vs.
 *  the mocked highlighter) is showing — both render the same visible text —
 *  so this is purely about test hygiene, not correctness. */
async function flushThemeLoad() {
    await act(async () => {
        await flushAsync()
    })
}

beforeEach(() => {
    useThemeMock.mockReturnValue({ theme: "dark", resolvedTheme: "dark" })
    vi.mocked(copyToClipboard).mockReset()
    vi.mocked(copyToClipboard).mockResolvedValue(true)
})

afterEach(() => {
    cleanup()
    vi.useRealTimers()
})

describe("CodeBlock", () => {
    it("renders the language label and the code value", async () => {
        const { container } = render(<CodeBlock language="javascript" value="const x = 1;" />)
        await flushThemeLoad()
        expect(screen.getByText("javascript")).toBeInTheDocument()
        expect(container.textContent).toContain("const x = 1;")
    })

    it("shows the Copy button by default", async () => {
        render(<CodeBlock language="text" value="hello" />)
        await flushThemeLoad()
        expect(screen.getByText("Copy")).toBeInTheDocument()
    })

    it.each([
        ["js", "javascript"],
        ["ts", "typescript"],
        ["py", "python"],
        ["rb", "ruby"],
        ["yml", "yaml"],
        ["sh", "bash"],
        ["shell", "bash"],
        ["zsh", "bash"],
        ["json5", "json"],
        ["jsonc", "json"],
        ["md", "markdown"],
        ["dockerfile", "docker"],
    ])("normalizes language alias %s -> %s", async (alias, expected) => {
        render(<CodeBlock language={alias} value="x" />)
        await flushThemeLoad()
        expect(screen.getByText(expected)).toBeInTheDocument()
    })

    it("passes through an unrecognized language unchanged (lowercased)", async () => {
        render(<CodeBlock language="RUST" value="fn main() {}" />)
        await flushThemeLoad()
        expect(screen.getByText("rust")).toBeInTheDocument()
    })

    it('defaults to "text" when no language is provided', async () => {
        render(<CodeBlock value="hello" />)
        await flushThemeLoad()
        expect(screen.getByText("text")).toBeInTheDocument()
    })

    it("calls copyToClipboard with the code value when the copy button is clicked", async () => {
        render(<CodeBlock language="javascript" value="const x = 1;" />)
        await flushThemeLoad()
        await act(async () => {
            fireEvent.click(screen.getByRole("button"))
            await Promise.resolve()
        })
        expect(copyToClipboard).toHaveBeenCalledWith("const x = 1;")
    })

    it("shows a Copied state after a successful copy, then reverts to Copy after 2s", async () => {
        render(<CodeBlock language="javascript" value="const x = 1;" />)
        await flushThemeLoad()
        vi.useFakeTimers()

        await act(async () => {
            fireEvent.click(screen.getByRole("button"))
            // Let the `await copyToClipboard(...)` microtask resolve so
            // `setCopied(true)` runs before we assert.
            await Promise.resolve()
            await Promise.resolve()
        })
        expect(screen.getByText("Copied")).toBeInTheDocument()

        act(() => {
            vi.advanceTimersByTime(2000)
        })
        expect(screen.getByText("Copy")).toBeInTheDocument()
        expect(screen.queryByText("Copied")).not.toBeInTheDocument()
    })

    it("does not flip to the Copied state when copyToClipboard resolves false", async () => {
        vi.mocked(copyToClipboard).mockResolvedValue(false)
        render(<CodeBlock language="javascript" value="const x = 1;" />)
        await flushThemeLoad()
        await act(async () => {
            fireEvent.click(screen.getByRole("button"))
            await Promise.resolve()
            await Promise.resolve()
        })
        expect(screen.queryByText("Copied")).not.toBeInTheDocument()
        expect(screen.getByText("Copy")).toBeInTheDocument()
    })

    it("clears a pending revert timer when Copy is clicked again before the 2s window elapses", async () => {
        render(<CodeBlock language="javascript" value="const x = 1;" />)
        await flushThemeLoad()
        vi.useFakeTimers()

        // First click starts a 2s revert timer.
        await act(async () => {
            fireEvent.click(screen.getByRole("button"))
            await Promise.resolve()
            await Promise.resolve()
        })
        expect(screen.getByText("Copied")).toBeInTheDocument()

        // Advance partway, then click again: this should clear the first
        // timer (line 78) rather than leaving two timers racing.
        act(() => {
            vi.advanceTimersByTime(1000)
        })
        await act(async () => {
            fireEvent.click(screen.getByRole("button"))
            await Promise.resolve()
            await Promise.resolve()
        })
        expect(screen.getByText("Copied")).toBeInTheDocument()

        // Only 1500ms after the SECOND click (2500ms total) — if the first
        // timer hadn't been cleared it would already have reverted by now.
        act(() => {
            vi.advanceTimersByTime(1500)
        })
        expect(screen.getByText("Copied")).toBeInTheDocument()

        act(() => {
            vi.advanceTimersByTime(500)
        })
        expect(screen.getByText("Copy")).toBeInTheDocument()
    })

    it("resolves the theme with the light Prism palette (m.oneLight) when resolvedTheme is not dark", async () => {
        useThemeMock.mockReturnValue({ theme: "light", resolvedTheme: "light" })
        render(<CodeBlock language="javascript" value="const x = 1;" />)
        await waitFor(() => {
            expect(screen.getByTestId("mock-syntax-highlighter")).toBeInTheDocument()
        })
        expect(screen.getByTestId("mock-syntax-highlighter")).toHaveTextContent("const x = 1;")
    })

    it("applies dark-theme container classes when resolvedTheme is dark", async () => {
        useThemeMock.mockReturnValue({ theme: "dark", resolvedTheme: "dark" })
        const { container } = render(<CodeBlock language="text" value="x" />)
        await flushThemeLoad()
        const root = container.firstChild as HTMLElement
        expect(root.className).toContain("bg-zinc-900")
        expect(root.className).toContain("border-zinc-800")
    })

    it("applies light-theme container classes when resolvedTheme is not dark", async () => {
        useThemeMock.mockReturnValue({ theme: "light", resolvedTheme: "light" })
        const { container } = render(<CodeBlock language="text" value="x" />)
        await flushThemeLoad()
        const root = container.firstChild as HTMLElement
        expect(root.className).toContain("bg-zinc-50")
        expect(root.className).toContain("border-zinc-200")
    })

    it("merges a custom className onto the container", async () => {
        const { container } = render(<CodeBlock value="x" className="my-custom-class" />)
        await flushThemeLoad()
        expect((container.firstChild as HTMLElement).className).toContain("my-custom-class")
    })

    it("upgrades from the plain <pre> fallback to the (mocked) SyntaxHighlighter once the real Prism theme module resolves", async () => {
        // `next/dynamic` is mocked above, but the Prism *theme* import inside
        // `useHighlighterTheme` is a real, unmocked dynamic import — it only
        // resolves after a real microtask/macrotask turn. `getByTestId`
        // presence is what flips the render from the initial plain-text
        // fallback to the highlighter branch, so waiting for it directly
        // verifies the documented "upgrade in-place" behaviour instead of
        // just hoping a single flushAsync() tick was enough.
        render(<CodeBlock language="javascript" value="const x = 1;" />)
        await waitFor(() => {
            expect(screen.getByTestId("mock-syntax-highlighter")).toBeInTheDocument()
        })
        expect(screen.getByTestId("mock-syntax-highlighter")).toHaveTextContent("const x = 1;")
    })
})

describe("InlineCode", () => {
    it("renders children inside a <code> element with the expected base classes", () => {
        render(<InlineCode>const x</InlineCode>)
        const code = screen.getByText("const x")
        expect(code.tagName).toBe("CODE")
        expect(code.className).toContain("font-mono")
    })

    it("merges a custom className", () => {
        render(<InlineCode className="extra-class">value</InlineCode>)
        expect(screen.getByText("value").className).toContain("extra-class")
    })
})

