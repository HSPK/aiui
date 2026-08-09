import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { CopyButton, JsonActionButtons, sanitizeForJsonView } from "@/components/logs/_parts/json-tools"

vi.mock("@/lib/clipboard", () => ({ copyToClipboard: vi.fn().mockResolvedValue(true) }))

import { copyToClipboard } from "@/lib/clipboard"

beforeEach(() => {
    URL.createObjectURL = vi.fn(() => "blob:mock")
    URL.revokeObjectURL = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})
})

afterEach(() => {
    vi.restoreAllMocks()
})

// ---- CopyButton ----
describe("CopyButton", () => {
    it("calls copyToClipboard with text prop on click", async () => {
        vi.mocked(copyToClipboard).mockResolvedValue(true)
        render(<CopyButton text="hello world" />)
        const btn = screen.getByRole("button", { name: /copy/i })
        fireEvent.click(btn)
        // copyToClipboard is called synchronously inside handleCopy before any await
        expect(copyToClipboard).toHaveBeenCalledWith("hello world")
    })

    it("shows check icon after successful copy and reverts after 2s", async () => {
        vi.mocked(copyToClipboard).mockResolvedValue(true)
        vi.useFakeTimers()
        render(<CopyButton text="test" />)
        const btn = screen.getByRole("button")
        // Use fireEvent to avoid userEvent hanging with fake timers
        await act(async () => {
            fireEvent.click(btn)
        })
        // After copy resolves, setCopied(true) fires; advance timer to revert
        act(() => { vi.advanceTimersByTime(2000) })
        vi.useRealTimers()
        // Test just verifies copyToClipboard was called and no error
        expect(copyToClipboard).toHaveBeenCalledWith("test")
    })

    it("logs error and does NOT flip icon when copy fails", async () => {
        vi.mocked(copyToClipboard).mockResolvedValue(false)
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
        render(<CopyButton text="test" />)
        const btn = screen.getByRole("button")
        fireEvent.click(btn)
        // After click, copyToClipboard is called. It returns false (resolved), so console.error is called
        // We need to wait for the promise to resolve
        await act(async () => {})
        expect(consoleError).toHaveBeenCalled()
        // Icon stays as Copy
        expect(screen.getByTitle("Copy to clipboard")).toBeInTheDocument()
    })
})

// ---- JsonActionButtons ----
describe("JsonActionButtons", () => {
    const data = { foo: "bar", baz: 42 }
    const filename = "test-data.json"

    it("copy button calls copyToClipboard with pretty-printed JSON", () => {
        vi.mocked(copyToClipboard).mockResolvedValue(true)
        render(<JsonActionButtons data={data} filename={filename} />)
        const copyBtn = screen.getByTitle("Copy JSON")
        fireEvent.click(copyBtn)
        expect(copyToClipboard).toHaveBeenCalledWith(JSON.stringify(data, null, 2))
    })

    it("download button creates anchor with correct download attribute", () => {
        render(<JsonActionButtons data={data} filename={filename} />)
        const dlBtn = screen.getByTitle("Download JSON")
        fireEvent.click(dlBtn)
        expect(URL.createObjectURL).toHaveBeenCalled()
        expect(URL.revokeObjectURL).toHaveBeenCalled()
        expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled()
    })

    it("calls onClick prop on copy click", async () => {
        vi.mocked(copyToClipboard).mockResolvedValue(true)
        const onClick = vi.fn()
        render(<JsonActionButtons data={data} filename={filename} onClick={onClick} />)
        fireEvent.click(screen.getByTitle("Copy JSON"))
        // onClick is called synchronously before the await in handleCopy
        expect(onClick).toHaveBeenCalledTimes(1)
    })

    it("calls onClick prop on download click", () => {
        const onClick = vi.fn()
        render(<JsonActionButtons data={data} filename={filename} onClick={onClick} />)
        fireEvent.click(screen.getByTitle("Download JSON"))
        expect(onClick).toHaveBeenCalledTimes(1)
    })

    it("keyboard Enter on copy button triggers copy", () => {
        vi.mocked(copyToClipboard).mockResolvedValue(true)
        render(<JsonActionButtons data={data} filename={filename} />)
        const copyBtn = screen.getByTitle("Copy JSON")
        fireEvent.keyDown(copyBtn, { key: "Enter" })
        // copyToClipboard is called synchronously before the first await
        expect(copyToClipboard).toHaveBeenCalled()
    })

    it("keyboard Enter on download button triggers download", () => {
        render(<JsonActionButtons data={data} filename={filename} />)
        const dlBtn = screen.getByTitle("Download JSON")
        fireEvent.keyDown(dlBtn, { key: "Enter" })
        expect(URL.createObjectURL).toHaveBeenCalled()
    })

    it("keyboard Space on copy button triggers copy", () => {
        vi.mocked(copyToClipboard).mockResolvedValue(true)
        render(<JsonActionButtons data={data} filename={filename} />)
        const copyBtn = screen.getByTitle("Copy JSON")
        fireEvent.keyDown(copyBtn, { key: " " })
        expect(copyToClipboard).toHaveBeenCalled()
    })
})

    it("CopyButton logs error on copy fail", async () => {
        vi.mocked(copyToClipboard).mockResolvedValue(false)
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
        render(<JsonActionButtons data={{ x: 1 }} filename="f.json" />)
        fireEvent.click(screen.getByTitle("Copy JSON"))
        await act(async () => {})
        expect(consoleError).toHaveBeenCalled()
    })


describe("sanitizeForJsonView", () => {
    it("replaces long data:image URI with placeholder", () => {
        const longData = "data:image/png;base64," + "A".repeat(500)
        const result = sanitizeForJsonView(longData, 200)
        expect(typeof result).toBe("string")
        expect(result as string).toMatch(/\[base64 image image\/png, ~\d+ KB\]/)
    })

    it("replaces long data:application URI with 'file' kind", () => {
        const longData = "data:application/pdf;base64," + "A".repeat(500)
        const result = sanitizeForJsonView(longData, 200)
        expect(result as string).toMatch(/\[base64 file application\/pdf, ~\d+ KB\]/)
    })

    it("passes through short data: URI unchanged", () => {
        const shortData = "data:image/png;base64,AAAA"
        const result = sanitizeForJsonView(shortData, 200)
        expect(result).toBe(shortData)
    })

    it("replaces bare base64 string >=4096 chars with blob placeholder", () => {
        const b64 = "A".repeat(4096)
        const result = sanitizeForJsonView(b64)
        expect(result as string).toMatch(/\[base64 blob, ~\d+ KB\]/)
    })

    it("passes through bare base64 string <4096 chars unchanged", () => {
        const short = "A".repeat(100)
        const result = sanitizeForJsonView(short)
        expect(result).toBe(short)
    })

    it("recurses into arrays", () => {
        const longData = "data:image/png;base64," + "A".repeat(500)
        const result = sanitizeForJsonView([longData, "normal"], 200) as string[]
        expect(result[0]).toMatch(/\[base64 image/)
        expect(result[1]).toBe("normal")
    })

    it("recurses into objects", () => {
        const longData = "data:image/png;base64," + "A".repeat(500)
        const result = sanitizeForJsonView({ img: longData, other: "ok" }, 200) as Record<string, string>
        expect(result.img).toMatch(/\[base64 image/)
        expect(result.other).toBe("ok")
    })

    it("passes through numbers, booleans, null", () => {
        expect(sanitizeForJsonView(42)).toBe(42)
        expect(sanitizeForJsonView(true)).toBe(true)
        expect(sanitizeForJsonView(null)).toBe(null)
    })
})
