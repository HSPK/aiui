import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup, within } from "@testing-library/react"

import { TopbarModalityStrip } from "@/components/playground/topbar-modality-strip"
import { MODALITIES } from "@/components/playground/modalities"
import { useModalityStore } from "@/lib/stores/modality-store"
import { resetModalityStore } from "../_render"

let pathnameMock = "/playground/chat"
vi.mock("next/navigation", () => ({
    usePathname: () => pathnameMock,
}))

vi.mock("next/link", () => ({
    default: ({ href, children, ...rest }: any) => (
        <a href={href} {...rest}>
            {children}
        </a>
    ),
}))

afterEach(() => {
    cleanup()
    resetModalityStore()
    pathnameMock = "/playground/chat"
})

describe("TopbarModalityStrip", () => {
    it("renders the strip with an accessible group label", () => {
        render(<TopbarModalityStrip />)
        expect(screen.getByLabelText("Playground modalities")).toBeInTheDocument()
    })

    it("renders a link per enabled modality and a non-link span for the disabled one", () => {
        render(<TopbarModalityStrip />)
        const enabled = MODALITIES.filter((m) => !m.disabled)
        expect(screen.getAllByRole("link")).toHaveLength(enabled.length)

        const rerank = MODALITIES.find((m) => m.id === "rerank")!
        const span = screen.getByTitle(`${rerank.title} (coming soon)`)
        expect(span.tagName).toBe("SPAN")
        expect(span).toHaveAttribute("aria-disabled", "true")
    })

    it("marks the active modality link with aria-current='page' and shows its label", () => {
        pathnameMock = "/playground/chat"
        render(<TopbarModalityStrip />)
        const chatLink = screen.getByTitle("Chat")
        expect(chatLink).toHaveAttribute("aria-current", "page")
        expect(within(chatLink).getByText("Chat")).toBeInTheDocument()
    })

    it("does not mark inactive modality links with aria-current and keeps their label hidden", () => {
        pathnameMock = "/playground/chat"
        render(<TopbarModalityStrip />)
        const embeddingLink = screen.getByTitle("Embeddings")
        expect(embeddingLink).not.toHaveAttribute("aria-current")
        expect(within(embeddingLink).queryByText("Embeddings")).not.toBeInTheDocument()
    })

    it("recognizes a nested pathname under a modality's href as active", () => {
        pathnameMock = "/playground/audio/transcription/session-42"
        render(<TopbarModalityStrip />)
        expect(screen.getByTitle("Audio transcription")).toHaveAttribute("aria-current", "page")
    })

    it("treats an unrelated pathname as no modality being active", () => {
        pathnameMock = "/dashboard"
        render(<TopbarModalityStrip />)
        for (const m of MODALITIES.filter((m) => !m.disabled)) {
            expect(screen.getByTitle(m.title)).not.toHaveAttribute("aria-current")
        }
    })

    it("uses the per-modality stored path override for the href instead of the static default", () => {
        useModalityStore.getState().setModalityPath("chat", "/playground/chat?c=abc123")
        render(<TopbarModalityStrip />)
        expect(screen.getByTitle("Chat")).toHaveAttribute("href", "/playground/chat?c=abc123")
    })

    it("falls back to the modality's static href when there is no stored override", () => {
        render(<TopbarModalityStrip />)
        expect(screen.getByTitle("Chat")).toHaveAttribute("href", "/playground/chat")
    })
})
