import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"

import { AttachmentsView } from "@/components/playground/_parts/attachments"
import type { ContentPart, TextPart, ImageUrlPart, FilePart, ToolCallPart, ToolResultPart } from "@/lib/schemas/content"

const textPart: TextPart = { type: "text", text: "hello" }
const imagePart: ImageUrlPart = {
    type: "image_url",
    image_url: { url: "https://example.com/cat.png" },
}
const filePart: FilePart = {
    type: "file",
    file: {
        filename: "report.pdf",
        file_data: "data:application/pdf;base64,AAAA",
        mime_type: "application/pdf",
    },
}
const toolCallPart: ToolCallPart = {
    type: "tool_call",
    tool_call: { id: "call_1", name: "search", arguments: "{}" },
}
const toolResultPart: ToolResultPart = {
    type: "tool_result",
    tool_result: { tool_call_id: "call_1", content: "result body" },
}

describe("AttachmentsView", () => {
    it("renders nothing when parts is empty", () => {
        const { container } = render(<AttachmentsView parts={[]} />)
        expect(container.firstChild).toBeNull()
    })

    it("renders an image attachment for an image_url part", () => {
        render(<AttachmentsView parts={[imagePart]} />)
        const img = screen.getByAltText("attachment") as HTMLImageElement
        expect(img.src).toBe("https://example.com/cat.png")
        expect(img).toHaveAttribute("loading", "lazy")
        const link = img.closest("a")
        expect(link).toHaveAttribute("href", "https://example.com/cat.png")
        expect(link).toHaveAttribute("target", "_blank")
    })

    it("renders a file attachment with filename, download attribute, and mime in the title", () => {
        render(<AttachmentsView parts={[filePart]} />)
        const link = screen.getByText("report.pdf").closest("a")
        expect(link).toHaveAttribute("href", "data:application/pdf;base64,AAAA")
        expect(link).toHaveAttribute("download", "report.pdf")
        expect(link).toHaveAttribute("title", "report.pdf (application/pdf)")
    })

    it("omits the mime suffix from the title when mime_type is absent", () => {
        const part: FilePart = {
            type: "file",
            file: { filename: "notes.txt", file_data: "data:text/plain;base64,AAAA" },
        }
        render(<AttachmentsView parts={[part]} />)
        const link = screen.getByText("notes.txt").closest("a")
        expect(link).toHaveAttribute("title", "notes.txt")
    })

    it("renders both image and file attachments together, in order", () => {
        render(<AttachmentsView parts={[imagePart, filePart]} />)
        expect(screen.getByAltText("attachment")).toBeInTheDocument()
        expect(screen.getByText("report.pdf")).toBeInTheDocument()
        expect(screen.getAllByRole("link")).toHaveLength(2)
    })

    it("does not render anything for content part types it doesn't handle (text/tool_call/tool_result)", () => {
        const { container } = render(<AttachmentsView parts={[textPart, toolCallPart, toolResultPart] as ContentPart[]} />)
        expect(screen.queryByRole("link")).not.toBeInTheDocument()
        expect(container.querySelector("img")).toBeNull()
        // The wrapper div still renders (parts.length > 0) but with no children.
        expect(container.firstChild).not.toBeNull()
        expect(container.firstChild?.textContent).toBe("")
    })

    it("skips unhandled part types interleaved with handled ones", () => {
        render(<AttachmentsView parts={[textPart, imagePart, toolResultPart] as ContentPart[]} />)
        expect(screen.getAllByRole("link")).toHaveLength(1)
        expect(screen.getByAltText("attachment")).toBeInTheDocument()
    })
})
