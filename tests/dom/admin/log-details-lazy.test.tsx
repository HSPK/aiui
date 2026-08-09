import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { renderWithQuery, flushAsync } from "./_render"
import { makeQuery } from "./_mocks"
import { logDetail } from "./_fixtures"

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
import { LogDetails } from "@/components/logs/log-details-lazy"

beforeEach(() => {
    vi.mocked(logs.useGet).mockReturnValue(makeQuery({ data: logDetail }) as any)
})

describe("LogDetails (lazy)", () => {
    it("eventually renders content after async resolution", async () => {
        renderWithQuery(<LogDetails logId={logDetail.id} open onOpenChange={vi.fn()} />)
        // Flush multiple times to allow dynamic import to resolve
        await flushAsync()
        await flushAsync()
        await flushAsync()
        // After the dynamic import resolves, the Sheet content should be visible
        await screen.findByText("Trace Details", {}, { timeout: 3000 })
    })

    it("renders model name after lazy resolution", async () => {
        renderWithQuery(<LogDetails logId={logDetail.id} open onOpenChange={vi.fn()} />)
        await flushAsync()
        await flushAsync()
        await flushAsync()
        await screen.findByText("gpt-4o", {}, { timeout: 3000 })
    })
})
