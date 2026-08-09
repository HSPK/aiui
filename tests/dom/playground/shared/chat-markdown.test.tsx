import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup, act } from "@testing-library/react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

import { markdownComponents } from "@/components/playground/_parts/chat-markdown"
import { flushAsync } from "../_render"

// `markdownComponents.code` renders fenced/multiline code via the real
// `CodeBlock`, which lazy-loads `react-syntax-highlighter` through
// `next/dynamic`. That third-party rendering isn't this file's concern —
// stub it out (same technique as code-block.test.tsx) so assertions here
// stay focused on chat-markdown's own overrides and don't depend on a
// large async package settling.
vi.mock("next/dynamic", () => ({
    default: () =>
        function MockSyntaxHighlighter(props: any) {
            return <pre data-testid="mock-syntax-highlighter">{props.children}</pre>
        },
}))

function renderMarkdown(markdown: string) {
    return render(
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {markdown}
        </ReactMarkdown>,
    )
}

afterEach(() => {
    cleanup()
})

describe("markdownComponents (via ReactMarkdown)", () => {
    it("renders bold, italic, strikethrough and links with the custom overrides", async () => {
        renderMarkdown("Some **bold**, *italic*, ~~gone~~ and [a link](https://example.com).")
        await act(async () => {
            await flushAsync()
        })

        const bold = screen.getByText("bold")
        expect(bold.tagName).toBe("STRONG")
        expect(bold.className).toContain("font-semibold")

        const italic = screen.getByText("italic")
        expect(italic.tagName).toBe("EM")

        const struck = screen.getByText("gone")
        expect(struck.tagName).toBe("DEL")
        expect(struck.className).toContain("line-through")

        const link = screen.getByRole("link", { name: "a link" })
        expect(link).toHaveAttribute("href", "https://example.com")
        expect(link).toHaveAttribute("target", "_blank")
        expect(link).toHaveAttribute("rel", "noopener noreferrer")
    })

    it("renders paragraphs as <div> instead of <p> (avoids block-in-<p> hydration errors)", async () => {
        const { container } = renderMarkdown("Just a plain paragraph of text.")
        await act(async () => {
            await flushAsync()
        })
        expect(container.querySelector("p")).toBeNull()
        expect(screen.getByText("Just a plain paragraph of text.").tagName).toBe("DIV")
    })

    it("renders inline code via InlineCode", async () => {
        renderMarkdown("Some `inline code` here.")
        await act(async () => {
            await flushAsync()
        })
        const code = screen.getByText("inline code")
        expect(code.tagName).toBe("CODE")
        expect(code.className).toContain("font-mono")
        // Inline code must NOT be upgraded to the block CodeBlock chrome.
        expect(screen.queryByText("Copy")).not.toBeInTheDocument()
    })

    it("renders a fenced code block with a language via CodeBlock", async () => {
        const { container } = renderMarkdown("```js\nconst x = 1;\n```")
        await act(async () => {
            await flushAsync()
        })
        // CodeBlock's own chrome: language label + Copy button.
        expect(screen.getByText("javascript")).toBeInTheDocument()
        expect(screen.getByText("Copy")).toBeInTheDocument()
        expect(container.textContent).toContain("const x = 1;")
    })

    it("renders a fenced code block without a language as CodeBlock with language='text'", async () => {
        renderMarkdown("```\nline one\nline two\n```")
        await act(async () => {
            await flushAsync()
        })
        expect(screen.getByText("text")).toBeInTheDocument()
        expect(screen.getByText("Copy")).toBeInTheDocument()
    })

    it("renders a fenced code block with a single line and no language as plain InlineCode (not CodeBlock)", async () => {
        renderMarkdown("```\njust one line\n```")
        await act(async () => {
            await flushAsync()
        })
        const code = screen.getByText("just one line")
        expect(code.tagName).toBe("CODE")
        expect(screen.queryByText("Copy")).not.toBeInTheDocument()
    })

    it("renders a plain (non-task) unordered list and ordered list with the disc/decimal styling", async () => {
        const { container } = renderMarkdown(
            ["- Apples", "- Bananas", "", "1. First", "2. Second"].join("\n"),
        )
        await act(async () => {
            await flushAsync()
        })
        const ul = container.querySelector("ul")
        const ol = container.querySelector("ol")
        expect(ul?.className).toContain("list-disc")
        expect(ul?.className).not.toContain("list-none")
        expect(ol?.className).toContain("list-decimal")
        expect(screen.getByText("Apples").closest("li")?.className).not.toContain("flex")
        expect(screen.getByText("First")).toBeInTheDocument()
    })

    it("renders a GFM table with the custom wrapper/thead/tbody/tr/th/td overrides", async () => {
        const { container } = renderMarkdown(["| A | B |", "|---|---|", "| 1 | 2 |"].join("\n"))
        await act(async () => {
            await flushAsync()
        })
        const table = screen.getByRole("table")
        expect(table.parentElement?.className).toContain("overflow-x-auto")
        expect(container.querySelector("thead")?.className).toContain("bg-muted/50")
        expect(screen.getByText("A").tagName).toBe("TH")
        expect(screen.getByText("1").tagName).toBe("TD")
    })

    it("renders GFM task list items with checkboxes reflecting their checked state", async () => {
        renderMarkdown(["- [x] Done thing", "- [ ] Not done"].join("\n"))
        await act(async () => {
            await flushAsync()
        })
        const checkboxes = screen.getAllByRole("checkbox") as HTMLInputElement[]
        expect(checkboxes).toHaveLength(2)
        expect(checkboxes[0].checked).toBe(true)
        expect(checkboxes[1].checked).toBe(false)
        expect(checkboxes[0]).toHaveAttribute("readonly")
    })

    it("renders headings h1-h3 with the correct heading level", async () => {
        renderMarkdown(["# Title", "## Subtitle", "### Section"].join("\n\n"))
        await act(async () => {
            await flushAsync()
        })
        expect(screen.getByRole("heading", { level: 1, name: "Title" })).toBeInTheDocument()
        expect(screen.getByRole("heading", { level: 2, name: "Subtitle" })).toBeInTheDocument()
        expect(screen.getByRole("heading", { level: 3, name: "Section" })).toBeInTheDocument()
    })

    it("renders headings h4-h6 with the correct heading level", async () => {
        renderMarkdown(["#### Level4", "##### Level5", "###### Level6"].join("\n\n"))
        await act(async () => {
            await flushAsync()
        })
        expect(screen.getByRole("heading", { level: 4, name: "Level4" })).toBeInTheDocument()
        expect(screen.getByRole("heading", { level: 5, name: "Level5" })).toBeInTheDocument()
        expect(screen.getByRole("heading", { level: 6, name: "Level6" })).toBeInTheDocument()
    })

    it("renders a horizontal rule and a blockquote", async () => {
        const { container } = renderMarkdown(["> quoted wisdom", "", "---", "", "after"].join("\n"))
        await act(async () => {
            await flushAsync()
        })
        expect(container.querySelector("hr")).toBeInTheDocument()
        const quote = screen.getByText("quoted wisdom")
        expect(quote.closest("blockquote")).not.toBeNull()
    })
})
