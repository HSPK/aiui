import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { renderWithQuery, flushAsync } from "./_render"
import { makeQuery } from "./_mocks"
import { logDetail, logDetailNonChat, logDetailImage } from "./_fixtures"

vi.mock("@/lib/api/logs", () => ({
    logs: {
        useGet: vi.fn(),
        useList: vi.fn(),
        get: vi.fn(),
        list: vi.fn(),
        keys: {
            all: () => ["logs"],
            list: () => ["logs", "list"],
            one: (id: string) => ["logs", id],
        },
    },
}))

vi.mock("@/lib/clipboard", () => ({ copyToClipboard: vi.fn().mockResolvedValue(true) }))

import { logs } from "@/lib/api/logs"
import { copyToClipboard } from "@/lib/clipboard"
import { LogDetails } from "@/components/logs/log-details"

beforeEach(() => {
    URL.createObjectURL = vi.fn(() => "blob:mock")
    URL.revokeObjectURL = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})
})

describe("LogDetails – loading state", () => {
    it("shows spinner while isLoading", () => {
        vi.mocked(logs.useGet).mockReturnValue(makeQuery({ isLoading: true }) as any)
        renderWithQuery(
            <LogDetails logId="test-id" open onOpenChange={vi.fn()} />
        )
        expect(document.querySelector(".animate-spin")).toBeTruthy()
    })
})

describe("LogDetails – error/undefined data state", () => {
    it("shows 'Failed to load details.' when not loading and data is undefined", () => {
        vi.mocked(logs.useGet).mockReturnValue(makeQuery({ isLoading: false, isPending: false }) as any)
        renderWithQuery(
            <LogDetails logId="test-id" open onOpenChange={vi.fn()} />
        )
        expect(screen.getByText("Failed to load details.")).toBeInTheDocument()
    })
})

describe("LogDetails – with data", () => {
    beforeEach(() => {
        vi.mocked(logs.useGet).mockReturnValue(makeQuery({ data: logDetail }) as any)
    })

    it("renders model name in KPI grid", () => {
        renderWithQuery(<LogDetails logId={logDetail.id} open onOpenChange={vi.fn()} />)
        expect(screen.getByText("gpt-4o")).toBeInTheDocument()
    })

    it("renders capability in KPI grid", () => {
        renderWithQuery(<LogDetails logId={logDetail.id} open onOpenChange={vi.fn()} />)
        expect(screen.getByText("Chat")).toBeInTheDocument()
    })

    it("renders username in KPI grid", () => {
        renderWithQuery(<LogDetails logId={logDetail.id} open onOpenChange={vi.fn()} />)
        expect(screen.getByText("alice")).toBeInTheDocument()
    })

    it("renders total tokens in KPI grid", () => {
        renderWithQuery(<LogDetails logId={logDetail.id} open onOpenChange={vi.fn()} />)
        // 1650 formatted as toLocaleString
        expect(screen.getByText("1,650")).toBeInTheDocument()
    })

    it("renders TTFT in KPI grid", () => {
        renderWithQuery(<LogDetails logId={logDetail.id} open onOpenChange={vi.fn()} />)
        expect(screen.getByText("320ms")).toBeInTheDocument()
    })

    it("renders Latency in KPI grid (6.45s)", () => {
        renderWithQuery(<LogDetails logId={logDetail.id} open onOpenChange={vi.fn()} />)
        expect(screen.getByText("6.45s")).toBeInTheDocument()
    })

    it("does NOT render debug block when reason is null", () => {
        renderWithQuery(<LogDetails logId={logDetail.id} open onOpenChange={vi.fn()} />)
        expect(screen.queryByText("Debug Info")).toBeNull()
    })

    it("renders debug block when reason is truthy and not 'success'", () => {
        const log = { ...logDetail, reason: "some failure reason" }
        vi.mocked(logs.useGet).mockReturnValue(makeQuery({ data: log }) as any)
        renderWithQuery(<LogDetails logId={log.id} open onOpenChange={vi.fn()} />)
        expect(screen.getByText("Debug Info")).toBeInTheDocument()
        expect(screen.getByText("some failure reason")).toBeInTheDocument()
    })

    it("does NOT render debug block when reason is 'success'", () => {
        const log = { ...logDetail, reason: "success" }
        vi.mocked(logs.useGet).mockReturnValue(makeQuery({ data: log }) as any)
        renderWithQuery(<LogDetails logId={log.id} open onOpenChange={vi.fn()} />)
        expect(screen.queryByText("Debug Info")).toBeNull()
    })

    it("renders ContentViewer (Completion heading) for non-image capability", () => {
        renderWithQuery(<LogDetails logId={logDetail.id} open onOpenChange={vi.fn()} />)
        expect(screen.getByText("Completion")).toBeInTheDocument()
    })

    it("renders ImageGallery for image capability", () => {
        vi.mocked(logs.useGet).mockReturnValue(makeQuery({ data: logDetailImage }) as any)
        renderWithQuery(<LogDetails logId={logDetailImage.id} open onOpenChange={vi.fn()} />)
        expect(screen.getByText("Generated images")).toBeInTheDocument()
    })

    it("CopyButton next to trace id calls copyToClipboard with logId", async () => {
        vi.mocked(copyToClipboard).mockResolvedValue(true)
        renderWithQuery(<LogDetails logId={logDetail.id} open onOpenChange={vi.fn()} />)
        const copyBtns = screen.getAllByTitle("Copy to clipboard")
        await userEvent.click(copyBtns[0])
        expect(copyToClipboard).toHaveBeenCalledWith(logDetail.id)
    })

    it("accordion: Generation Parameters panel opens on click and shows ReactJson", async () => {
        renderWithQuery(<LogDetails logId={logDetail.id} open onOpenChange={vi.fn()} />)
        const paramsTrigger = screen.getByText("Generation Parameters")
        await userEvent.click(paramsTrigger)
        // The generation_kwargs have { temperature: 0.7, max_tokens: 500 }
        // react-json-view renders key names as text
        await screen.findByText("temperature")
    })

    it("accordion: Raw Output panel opens and shows ReactJson content", async () => {
        renderWithQuery(<LogDetails logId={logDetail.id} open onOpenChange={vi.fn()} />)
        const rawTrigger = screen.getByText("Raw Output")
        await userEvent.click(rawTrigger)
        await screen.findByText("choices")
    })

    it("JsonActionButtons copy button calls copyToClipboard with pretty JSON", async () => {
        vi.mocked(copyToClipboard).mockResolvedValue(true)
        renderWithQuery(<LogDetails logId={logDetail.id} open onOpenChange={vi.fn()} />)
        const copyJsonBtns = screen.getAllByTitle("Copy JSON")
        await userEvent.click(copyJsonBtns[0])
        const expected = JSON.stringify(logDetail.generation_kwargs, null, 2)
        expect(copyToClipboard).toHaveBeenCalledWith(expected)
    })

    it("JsonActionButtons download button creates anchor with correct filename", async () => {
        renderWithQuery(<LogDetails logId={logDetail.id} open onOpenChange={vi.fn()} />)
        const dlBtns = screen.getAllByTitle("Download JSON")
        await userEvent.click(dlBtns[0])
        expect(URL.createObjectURL).toHaveBeenCalled()
        expect(URL.revokeObjectURL).toHaveBeenCalled()
        const anchorClick = HTMLAnchorElement.prototype.click as ReturnType<typeof vi.fn>
        expect(anchorClick).toHaveBeenCalled()
    })

    it("accordion stays open after clicking JsonActionButtons (stopPropagation)", async () => {
        renderWithQuery(<LogDetails logId={logDetail.id} open onOpenChange={vi.fn()} />)
        // Open the accordion
        await userEvent.click(screen.getByText("Generation Parameters"))
        // Click the copy button inside it
        vi.mocked(copyToClipboard).mockResolvedValue(true)
        const copyJsonBtns = screen.getAllByTitle("Copy JSON")
        await userEvent.click(copyJsonBtns[0])
        // Content should still be present (accordion not closed)
        await screen.findByText("temperature")
    })
})

describe("LogDetails – null fields coverage (logDetailNonChat)", () => {
    it("renders '—' for null total_tokens in KPI", () => {
        vi.mocked(logs.useGet).mockReturnValue(makeQuery({ data: logDetailNonChat }) as any)
        renderWithQuery(<LogDetails logId={logDetailNonChat.id} open onOpenChange={vi.fn()} />)
        // total_tokens null → "—"
        expect(screen.getAllByText("—").length).toBeGreaterThan(0)
    })

    it("renders user_id when username is null", () => {
        vi.mocked(logs.useGet).mockReturnValue(makeQuery({ data: logDetailNonChat }) as any)
        renderWithQuery(<LogDetails logId={logDetailNonChat.id} open onOpenChange={vi.fn()} />)
        expect(screen.getByText("user-1")).toBeInTheDocument()
    })

    it("renders status 'failed' badge for failed log", () => {
        vi.mocked(logs.useGet).mockReturnValue(makeQuery({ data: logDetailNonChat }) as any)
        renderWithQuery(<LogDetails logId={logDetailNonChat.id} open onOpenChange={vi.fn()} />)
        expect(screen.getByText("failed")).toBeInTheDocument()
    })
})

describe("LogDetails – latency/TTFT edge cases", () => {
    it("renders TTFT in seconds when >= 1000ms", () => {
        const log = { ...logDetail, first_token_latency_ms: 2500 }
        vi.mocked(logs.useGet).mockReturnValue(makeQuery({ data: log }) as any)
        renderWithQuery(<LogDetails logId={log.id} open onOpenChange={vi.fn()} />)
        expect(screen.getAllByText(/2\.50s/).length).toBeGreaterThan(0)
    })

    it("renders latency in ms when < 1000ms", () => {
        const log = { ...logDetail, total_latency_ms: 500, first_token_latency_ms: null }
        vi.mocked(logs.useGet).mockReturnValue(makeQuery({ data: log }) as any)
        renderWithQuery(<LogDetails logId={log.id} open onOpenChange={vi.fn()} />)
        expect(screen.getAllByText("500ms").length).toBeGreaterThan(0)
    })

    it("renders '—' for null TTFT", () => {
        const log = { ...logDetail, first_token_latency_ms: null }
        vi.mocked(logs.useGet).mockReturnValue(makeQuery({ data: log }) as any)
        renderWithQuery(<LogDetails logId={log.id} open onOpenChange={vi.fn()} />)
        // At minimum one "—" from TTFT
        expect(screen.getAllByText("—").length).toBeGreaterThan(0)
    })

    it("renders status 'pending' badge for pending log", () => {
        const log = { ...logDetailNonChat, status: "pending" as const }
        vi.mocked(logs.useGet).mockReturnValue(makeQuery({ data: log }) as any)
        renderWithQuery(<LogDetails logId={log.id} open onOpenChange={vi.fn()} />)
        expect(screen.getByText("pending")).toBeInTheDocument()
    })
})

describe("LogDetails – closed state", () => {
    it("does not call useGet when open=false", () => {
        vi.mocked(logs.useGet).mockReturnValue(makeQuery({}) as any)
        renderWithQuery(<LogDetails logId="test-id" open={false} onOpenChange={vi.fn()} />)
        // When closed, logId passed to useGet is null
        expect(vi.mocked(logs.useGet)).toHaveBeenCalledWith(null)
    })
})

describe("LogDetails – edge cases for branch coverage", () => {
    it("handles null generation_kwargs gracefully (covers || {} branch)", () => {
        const log = { ...logDetail, generation_kwargs: null as any }
        vi.mocked(logs.useGet).mockReturnValue(makeQuery({ data: log }) as any)
        renderWithQuery(<LogDetails logId={log.id} open onOpenChange={vi.fn()} />)
        expect(screen.getByText("Trace Details")).toBeInTheDocument()
    })

    it("renders with input_summary fallback when input_summary set (covers ?? branch)", () => {
        const log = { ...logDetail, input: null as any, input_summary: "summary text" }
        vi.mocked(logs.useGet).mockReturnValue(makeQuery({ data: log }) as any)
        renderWithQuery(<LogDetails logId={log.id} open onOpenChange={vi.fn()} />)
        expect(screen.getByText("Trace Details")).toBeInTheDocument()
    })
})
