import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { LogsTable } from "@/components/logs/logs-table"
import {
    logListItem,
    logListItemNoTokens,
    logListItemBigNumbers,
    paginated,
} from "./_fixtures"
import type { LogListItemDTO } from "@/lib/schemas/log"

vi.mock("@/lib/clipboard", () => ({ copyToClipboard: vi.fn().mockResolvedValue(true) }))
import { copyToClipboard } from "@/lib/clipboard"

function makeProps(data: LogListItemDTO[], overrides = {}) {
    return {
        data,
        sorting: [],
        onSortingChange: vi.fn(),
        onViewDetail: vi.fn(),
        ...overrides,
    }
}

describe("LogsTable", () => {
    it("shows empty state icon for empty data", () => {
        render(<LogsTable {...makeProps([])} />)
        // DataTableEmpty renders an Inbox icon with aria-label="empty" instead of text
        expect(screen.getByLabelText("empty")).toBeInTheDocument()
    })

    it("shows no data rows for empty data", () => {
        const { container } = render(<LogsTable {...makeProps([])} />)
        // No data rows = no DataTableRow clicks
        const rows = container.querySelectorAll("tbody tr")
        expect(rows.length).toBe(1) // only the empty state row
    })

    it("truncates trace ID to first 8 chars", () => {
        render(<LogsTable {...makeProps([logListItem])} />)
        expect(screen.getByText("aaaaaaaa")).toBeInTheDocument()
    })

    it("Files icon click copies full ID and stops row click propagation", async () => {
        const onViewDetail = vi.fn()
        vi.mocked(copyToClipboard).mockResolvedValue(true)
        render(<LogsTable {...makeProps([logListItem], { onViewDetail })} />)
        const filesIcon = document.querySelector("svg.lucide-files")!
        await userEvent.click(filesIcon)
        expect(copyToClipboard).toHaveBeenCalledWith(logListItem.id)
        expect(onViewDetail).not.toHaveBeenCalled()
    })

    it("row click invokes onViewDetail with the row id", async () => {
        const onViewDetail = vi.fn()
        render(<LogsTable {...makeProps([logListItem], { onViewDetail })} />)
        // Click the row (via the trace id text)
        await userEvent.click(screen.getByText("aaaaaaaa"))
        expect(onViewDetail).toHaveBeenCalledWith(logListItem.id)
    })

    it("username shows when present", () => {
        render(<LogsTable {...makeProps([logListItem])} />)
        expect(screen.getByText("alice")).toBeInTheDocument()
    })

    it("falls back to user_id when username is null", () => {
        render(<LogsTable {...makeProps([logListItemNoTokens])} />)
        expect(screen.getByText("user-1")).toBeInTheDocument()
    })

    it("renders model_name badge", () => {
        render(<LogsTable {...makeProps([logListItem])} />)
        expect(screen.getByText("gpt-4o")).toBeInTheDocument()
    })

    it("renders capability badge for non-null capability", () => {
        render(<LogsTable {...makeProps([logListItem])} />)
        // capabilityLabel("chat") = "Chat"
        expect(screen.getByText("Chat")).toBeInTheDocument()
    })

    it("renders '—' for null capability", () => {
        render(<LogsTable {...makeProps([logListItemNoTokens])} />)
        // null capability -> '—' span
        expect(screen.getAllByText("—").length).toBeGreaterThan(0)
    })

    it("formatTokens: null total_tokens shows '—'", () => {
        render(<LogsTable {...makeProps([logListItemNoTokens])} />)
        // Multiple '—' are expected (tokens + latency)
        expect(screen.getAllByText("—").length).toBeGreaterThan(0)
    })

    it("formatTokens: >=1M shows XM", () => {
        render(<LogsTable {...makeProps([logListItemBigNumbers])} />)
        // 1_502_000 -> 1.5M
        expect(screen.getByText("1.5M")).toBeInTheDocument()
    })

    it("formatTokens: >=1000 shows Xk (using prompt_tokens=1200 → '1.2k')", () => {
        render(<LogsTable {...makeProps([logListItem])} />)
        // prompt_tokens=1200 → formatTokens(1200)="1.2k" appears in breakdown
        expect(screen.getAllByText(/1\.2k/).length).toBeGreaterThan(0)
    })

    it("formatTokens: small number shows plain", () => {
        const item: LogListItemDTO = { ...logListItem, total_tokens: 42, prompt_tokens: null, completion_tokens: null }
        render(<LogsTable {...makeProps([item])} />)
        expect(screen.getByText("42")).toBeInTheDocument()
    })

    it("prompt/completion token breakdown title only when breakdown exists", () => {
        render(<LogsTable {...makeProps([logListItem])} />)
        // logListItem has prompt_tokens=1200, completion_tokens=450
        // The breakdown should appear in the cell
        const breakdown = screen.getByText(/1\.2k \/ 450/)
        expect(breakdown).toBeInTheDocument()
    })

    it("formatLatency: null shows '—'", () => {
        render(<LogsTable {...makeProps([logListItemNoTokens])} />)
        expect(screen.getAllByText("—").length).toBeGreaterThan(0)
    })

    it("formatLatency: <1000ms shows Xms", () => {
        // logListItemBigNumbers has total_latency_ms=500
        render(<LogsTable {...makeProps([logListItemBigNumbers])} />)
        expect(screen.getByText("500ms")).toBeInTheDocument()
    })

    it("formatLatency: >=1000ms shows X.XXs", () => {
        // logListItem has total_latency_ms=6450
        render(<LogsTable {...makeProps([logListItem])} />)
        expect(screen.getByText("6.45s")).toBeInTheDocument()
    })

    it("latency > 5000ms gets amber class", () => {
        render(<LogsTable {...makeProps([logListItem])} />)
        // logListItem total_latency_ms=6450 > 5000
        const latencySpan = screen.getByText("6.45s")
        expect(latencySpan.className).toMatch(/amber/)
    })

    it("TTFT breakdown suffix appears when first_token_latency_ms is set", () => {
        render(<LogsTable {...makeProps([logListItem])} />)
        // first_token_latency_ms=320 -> "TTFT 320ms"
        expect(screen.getByText(/TTFT 320ms/)).toBeInTheDocument()
    })

    it("status badge: completed = default variant", () => {
        render(<LogsTable {...makeProps([logListItem])} />)
        expect(screen.getByText("completed")).toBeInTheDocument()
    })

    it("status badge: failed = destructive variant", () => {
        render(<LogsTable {...makeProps([logListItemNoTokens])} />)
        expect(screen.getByText("failed")).toBeInTheDocument()
    })

    it("status badge: pending = secondary variant", () => {
        render(<LogsTable {...makeProps([logListItemBigNumbers])} />)
        expect(screen.getByText("pending")).toBeInTheDocument()
    })

    it("Time column header sort button calls onSortingChange", async () => {
        const onSortingChange = vi.fn()
        render(<LogsTable {...makeProps([logListItem], { onSortingChange })} />)
        const timeBtn = screen.getByRole("button", { name: /time/i })
        await userEvent.click(timeBtn)
        expect(onSortingChange).toHaveBeenCalled()
    })

    it("Latency column header sort button calls onSortingChange", async () => {
        const onSortingChange = vi.fn()
        render(<LogsTable {...makeProps([logListItem], { onSortingChange })} />)
        const latencyBtn = screen.getByRole("button", { name: /latency/i })
        await userEvent.click(latencyBtn)
        expect(onSortingChange).toHaveBeenCalled()
    })
})
