import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { ContentViewer } from "@/components/logs/_parts/content-viewer"
import { logMarkdownComponents } from "@/components/logs/_parts/markdown"
import { richMarkdown } from "./_fixtures"

vi.mock("@/lib/clipboard", () => ({ copyToClipboard: vi.fn().mockResolvedValue(true) }))
import { copyToClipboard } from "@/lib/clipboard"

describe("ContentViewer", () => {
    it("shows 'No content recorded' for null content", () => {
        render(<ContentViewer title="Test" content={null} colorClass="bg-green-500" />)
        expect(screen.getByText("No content recorded")).toBeInTheDocument()
    })

    it("shows 'No content recorded' for empty string content", () => {
        render(<ContentViewer title="Test" content="" colorClass="bg-green-500" />)
        expect(screen.getByText("No content recorded")).toBeInTheDocument()
    })

    it("renders title", () => {
        render(<ContentViewer title="Completion" content="hello" colorClass="bg-green-500" />)
        expect(screen.getByText("Completion")).toBeInTheDocument()
    })

    it("renders preview mode by default with markdown", () => {
        render(<ContentViewer title="T" content={richMarkdown} colorClass="bg-green-500" />)
        // table from richMarkdown
        expect(document.querySelector("table")).toBeTruthy()
    })

    it("renders checked checkbox from richMarkdown task list", () => {
        render(<ContentViewer title="T" content={richMarkdown} colorClass="bg-green-500" />)
        const checkboxes = screen.getAllByRole("checkbox")
        const checked = checkboxes.find((c) => (c as HTMLInputElement).checked)
        expect(checked).toBeTruthy()
        const unchecked = checkboxes.find((c) => !(c as HTMLInputElement).checked)
        expect(unchecked).toBeTruthy()
    })

    it("renders link from richMarkdown", () => {
        render(<ContentViewer title="T" content={richMarkdown} colorClass="bg-green-500" />)
        expect(screen.getByRole("link", { name: "link" })).toHaveAttribute("href", "https://example.com")
    })

    it("renders code block with const x = 1", () => {
        render(<ContentViewer title="T" content={richMarkdown} colorClass="bg-green-500" />)
        expect(screen.getByText("const x = 1;")).toBeInTheDocument()
    })

    it("renders blockquote", () => {
        render(<ContentViewer title="T" content={richMarkdown} colorClass="bg-green-500" />)
        expect(document.querySelector("blockquote")).toBeTruthy()
    })

    it("renders hr", () => {
        render(<ContentViewer title="T" content={richMarkdown} colorClass="bg-green-500" />)
        expect(document.querySelector("hr")).toBeTruthy()
    })

    it("switches to raw mode on Raw button click", async () => {
        render(<ContentViewer title="T" content="hello raw" colorClass="bg-green-500" />)
        await userEvent.click(screen.getByRole("button", { name: /raw/i }))
        expect(screen.getByText("hello raw")).toBeInTheDocument()
        expect(document.querySelector("pre")).toBeTruthy()
    })

    it("switches back to preview mode on Preview button click", async () => {
        render(<ContentViewer title="T" content="toggle test" colorClass="bg-green-500" />)
        // First go to raw mode
        await userEvent.click(screen.getByRole("button", { name: /raw/i }))
        expect(document.querySelector("pre")).toBeTruthy()
        // Then click Preview to go back — covers the Preview onClick callback
        await userEvent.click(screen.getByRole("button", { name: /preview/i }))
        // pre element should be gone, markdown rendered instead
        expect(document.querySelector("pre")).toBeFalsy()
        expect(screen.getByText("toggle test")).toBeInTheDocument()
    })

    it("CopyButton copies the exact content string", async () => {
        vi.mocked(copyToClipboard).mockResolvedValue(true)
        render(<ContentViewer title="T" content="copy me" colorClass="bg-green-500" />)
        await userEvent.click(screen.getByTitle("Copy to clipboard"))
        expect(copyToClipboard).toHaveBeenCalledWith("copy me")
    })
})

// ---- markdown.tsx branch coverage ----
describe("logMarkdownComponents – branch coverage", () => {
    it("renders inline code path", () => {
        const CodeComp = logMarkdownComponents.code as any
        const { container } = render(<CodeComp inline={true} className={undefined} children="inline code" node={null} />)
        // Inline code renders a <code> element (not a <pre>)
        expect(container.querySelector("code")).toBeTruthy()
        expect(container.querySelector("pre")).toBeFalsy()
    })

    it("renders block code path", () => {
        const CodeComp = logMarkdownComponents.code as any
        const { container } = render(<CodeComp inline={false} className={undefined} children="block code" node={null} />)
        expect(container.querySelector("pre")).toBeTruthy()
        expect(container.querySelector("code")).toBeTruthy()
    })

    it("renders non-checkbox input type", () => {
        const InputComp = logMarkdownComponents.input as any
        const { container } = render(<InputComp type="text" />)
        const input = container.querySelector("input") as HTMLInputElement
        expect(input).toBeTruthy()
        expect(input.type).toBe("text")
    })

    it("renders checkbox input type", () => {
        const InputComp = logMarkdownComponents.input as any
        const { container } = render(<InputComp type="checkbox" checked={true} />)
        const input = container.querySelector("input") as HTMLInputElement
        expect(input.type).toBe("checkbox")
    })

    it("renders plain ul (not task list) without checkboxes", () => {
        render(<ContentViewer title="T" content="- item one\n- item two" colorClass="bg-green-500" />)
        // Plain list items should render without checkbox inputs
        expect(document.querySelector("ul")).toBeTruthy()
        // No checkboxes in plain list
        const checkboxes = screen.queryAllByRole("checkbox")
        expect(checkboxes).toHaveLength(0)
    })

    it("ul with task items has isTaskList=true", () => {
        render(<ContentViewer title="T" content="- [ ] a\n- [x] b" colorClass="bg-green-500" />)
        // At least one checkbox should render from the task list
        expect(screen.getAllByRole("checkbox").length).toBeGreaterThan(0)
    })
})
