import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import {
    ModalityShell,
    ModalityShellSubmit,
    CmdEnterHint,
} from "@/components/playground/modality-shell"

afterEach(() => {
    cleanup()
})

describe("ModalityShell", () => {
    it("renders the header, children and action slots", () => {
        render(
            <ModalityShell header={<div>Header content</div>} action={<button>Submit</button>}>
                <p>Body content</p>
            </ModalityShell>
        )
        expect(screen.getByText("Header content")).toBeInTheDocument()
        expect(screen.getByText("Body content")).toBeInTheDocument()
        expect(screen.getByRole("button", { name: "Submit" })).toBeInTheDocument()
    })

    it("renders no error card and no result content when neither prop is given", () => {
        const { container } = render(
            <ModalityShell header={<div>H</div>} action={<div>A</div>}>
                <div>C</div>
            </ModalityShell>
        )
        expect(container.querySelector(".border-destructive\\/50")).not.toBeInTheDocument()
    })

    it("renders a destructive error card with the message when `error` is set", () => {
        render(
            <ModalityShell header={<div>H</div>} action={<div>A</div>} error="Something went wrong: 500">
                <div>C</div>
            </ModalityShell>
        )
        expect(screen.getByText("Something went wrong: 500")).toBeInTheDocument()
    })

    it("renders the `result` slot below the form", () => {
        render(
            <ModalityShell header={<div>H</div>} action={<div>A</div>} result={<div>Result payload</div>}>
                <div>C</div>
            </ModalityShell>
        )
        expect(screen.getByText("Result payload")).toBeInTheDocument()
    })

    it("uses the default max-w-4xl content width unless overridden", () => {
        const { container, rerender } = render(
            <ModalityShell header={<div>H</div>} action={<div>A</div>}>
                <div>C</div>
            </ModalityShell>
        )
        expect(container.querySelector(".max-w-4xl")).toBeInTheDocument()

        rerender(
            <ModalityShell header={<div>H</div>} action={<div>A</div>} maxWidth="max-w-6xl">
                <div>C</div>
            </ModalityShell>
        )
        expect(container.querySelector(".max-w-6xl")).toBeInTheDocument()
        expect(container.querySelector(".max-w-4xl")).not.toBeInTheDocument()
    })
})

describe("ModalityShellSubmit", () => {
    it("renders the idle label and calls onClick when clicked", async () => {
        const user = userEvent.setup()
        const onClick = vi.fn()
        render(<ModalityShellSubmit onClick={onClick} label="Generate" />)
        const button = screen.getByRole("button", { name: "Generate" })
        await user.click(button)
        expect(onClick).toHaveBeenCalledTimes(1)
    })

    it("shows a Play icon (not a spinner) in the idle state", () => {
        const { container } = render(<ModalityShellSubmit onClick={vi.fn()} label="Generate" />)
        expect(container.querySelector(".lucide-play")).toBeInTheDocument()
        expect(container.querySelector(".lucide-loader-circle")).not.toBeInTheDocument()
    })

    it("disables the button and does not fire onClick when `disabled` is true", async () => {
        const user = userEvent.setup()
        const onClick = vi.fn()
        render(<ModalityShellSubmit onClick={onClick} label="Generate" disabled />)
        const button = screen.getByRole("button", { name: "Generate" })
        expect(button).toBeDisabled()
        await user.click(button)
        expect(onClick).not.toHaveBeenCalled()
    })

    it("shows a spinner and the custom runningLabel while running", () => {
        const { container } = render(
            <ModalityShellSubmit onClick={vi.fn()} label="Generate" running runningLabel="Generating…" />
        )
        expect(screen.getByRole("button", { name: "Generating…" })).toBeInTheDocument()
        expect(screen.queryByText("Generate")).not.toBeInTheDocument()
        expect(container.querySelector(".lucide-loader-circle.animate-spin")).toBeInTheDocument()
        expect(container.querySelector(".lucide-play")).not.toBeInTheDocument()
    })

    it("falls back to the default 'Working…' label while running when runningLabel is omitted", () => {
        render(<ModalityShellSubmit onClick={vi.fn()} label="Generate" running />)
        expect(screen.getByRole("button", { name: "Working…" })).toBeInTheDocument()
    })

    it("renders the optional hint content", () => {
        render(<ModalityShellSubmit onClick={vi.fn()} label="Generate" hint={<span>Press Enter</span>} />)
        expect(screen.getByText("Press Enter")).toBeInTheDocument()
    })
})

describe("CmdEnterHint", () => {
    it("renders the keyboard shortcut and trailing text", () => {
        render(<CmdEnterHint />)
        expect(screen.getByText("⌘/Ctrl + Enter")).toBeInTheDocument()
        expect(screen.getByText(/to run/)).toBeInTheDocument()
    })

    it("renders optional children after the shortcut text", () => {
        render(
            <CmdEnterHint>
                <span>· extra note</span>
            </CmdEnterHint>
        )
        expect(screen.getByText("· extra note")).toBeInTheDocument()
    })
})
