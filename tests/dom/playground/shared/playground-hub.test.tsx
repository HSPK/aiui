import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"

import { PlaygroundHub } from "@/components/playground/playground-hub"
import { MODALITIES } from "@/components/playground/modalities"

vi.mock("next/link", () => ({
    default: ({ href, children, ...rest }: any) => (
        <a href={href} {...rest}>
            {children}
        </a>
    ),
}))

afterEach(() => {
    cleanup()
})

describe("PlaygroundHub", () => {
    it("renders the page heading and description", () => {
        render(<PlaygroundHub />)
        expect(screen.getByRole("heading", { name: "Playground" })).toBeInTheDocument()
        expect(
            screen.getByText("Test any capability over your registered providers. Pick a modality to begin.")
        ).toBeInTheDocument()
    })

    it("renders one card per modality with its title and description", () => {
        render(<PlaygroundHub />)
        for (const m of MODALITIES) {
            expect(screen.getByRole("heading", { level: 3, name: m.title })).toBeInTheDocument()
            expect(screen.getByText(m.description)).toBeInTheDocument()
        }
    })

    it("wraps every non-disabled modality in a link to its href", () => {
        render(<PlaygroundHub />)
        for (const m of MODALITIES.filter((m) => !m.disabled)) {
            const heading = screen.getByRole("heading", { level: 3, name: m.title })
            const link = heading.closest("a")
            expect(link).not.toBeNull()
            expect(link).toHaveAttribute("href", m.href)
        }
    })

    it("renders the disabled (rerank) modality with a 'Soon' badge and no link wrapper", () => {
        render(<PlaygroundHub />)
        const rerank = MODALITIES.find((m) => m.id === "rerank")!
        expect(rerank.disabled).toBe(true)

        const heading = screen.getByRole("heading", { level: 3, name: rerank.title })
        expect(heading.parentElement?.textContent).toContain("Soon")
        expect(heading.closest("a")).toBeNull()
        expect(screen.queryByRole("link", { name: new RegExp(rerank.title, "i") })).not.toBeInTheDocument()
    })

    it("does not show a 'Soon' badge on non-disabled modalities", () => {
        render(<PlaygroundHub />)
        for (const m of MODALITIES.filter((m) => !m.disabled)) {
            const heading = screen.getByRole("heading", { level: 3, name: m.title })
            expect(heading.parentElement?.textContent).not.toContain("Soon")
        }
    })

    it("renders exactly MODALITIES.length cards", () => {
        render(<PlaygroundHub />)
        expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(MODALITIES.length)
    })
})
