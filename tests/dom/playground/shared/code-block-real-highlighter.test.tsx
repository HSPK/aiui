import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup, waitFor } from "@testing-library/react"

import { CodeBlock } from "@/components/playground/code-block"

// Unlike `code-block.test.tsx` (which stubs `next/dynamic` for speed and
// determinism), this file deliberately does NOT mock `next/dynamic` or the
// real `react-syntax-highlighter` package. The lazy-loader callback and the
// `.then((m) => m.Prism)` extraction passed to `dynamic(...)` are only ever
// invoked by Next's real dynamic-import machinery, so a suite that always
// stubs `next/dynamic` can never actually execute that loader body. This
// file exists solely to exercise that real code path once, end to end,
// while staying fully deterministic (no network — `react-syntax-highlighter`
// is a local, already-installed dependency, so the dynamic import resolves
// from disk).
vi.mock("next-themes", () => ({ useTheme: () => ({ theme: "dark", resolvedTheme: "dark" }) }))
vi.mock("@/lib/clipboard", () => ({ copyToClipboard: vi.fn() }))

afterEach(() => {
    cleanup()
})

describe("CodeBlock (real next/dynamic highlighter)", () => {
    it("lazy-loads the real react-syntax-highlighter and tokenizes the code", async () => {
        render(<CodeBlock language="javascript" value="const answer = 42;" />)

        // Until both the theme module and the highlighter chunk resolve, the
        // component shows the plain <pre><code> fallback (no tokens). Once
        // the real dynamic import lands, Prism annotates the source with
        // `.token` spans — that's proof the real loader (not a mock) ran.
        await waitFor(
            () => {
                const tokens = document.querySelectorAll('code span[class*="token"]')
                expect(tokens.length).toBeGreaterThan(0)
            },
            { timeout: 10_000 },
        )

        expect(screen.getByText("javascript")).toBeInTheDocument()
        // The literal source text is still present, just wrapped in token spans.
        expect(document.body.textContent).toContain("const answer = 42;")
    }, 15_000)
})
