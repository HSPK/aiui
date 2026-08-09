import { describe, it, expect, vi, beforeEach } from "vitest"
import { screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { toast } from "sonner"

import { McpServersTable } from "@/components/tools/mcp-table"
import { renderWithQuery } from "./_render"
import { mcpServerStdio, mcpServerHttp, mcpServerUnchecked } from "./_fixtures"
import { makeMutation, makePendingSetMutation } from "./_mocks"
import { mcpServers } from "@/lib/api/mcp"

vi.mock("@/lib/api/mcp", () => ({
    mcpServers: {
        useList: vi.fn(),
        useCreate: vi.fn(),
        useUpdate: vi.fn(),
        useDelete: vi.fn(),
        useCheck: vi.fn(),
        useCheckStream: vi.fn(),
        useRuntime: vi.fn(),
        useStop: vi.fn(),
        useRestart: vi.fn(),
        usePresets: vi.fn(),
        listPresets: vi.fn(),
        list: vi.fn(),
        keys: {
            all: () => ["mcp-servers"],
            list: () => ["mcp-servers", "list"],
            one: (id: string) => ["mcp-servers", id],
        },
        runtimeKey: (id: string) => ["mcp-servers", id, "runtime"],
    },
}))

vi.mock("sonner", () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

function setup(checkOverrides?: Parameters<typeof makePendingSetMutation>[0]) {
    const update = makeMutation()
    const check = makePendingSetMutation(checkOverrides)
    vi.mocked(mcpServers.useUpdate).mockReturnValue(update as ReturnType<typeof makeMutation>)
    vi.mocked(mcpServers.useCheck).mockReturnValue(check)
    return { update, check }
}

describe("McpServersTable", () => {
    beforeEach(() => setup())

    describe("empty state", () => {
        it("renders empty state when servers is empty", () => {
            renderWithQuery(
                <McpServersTable servers={[]} />
            )
            // DataTableEmpty renders a row — verify no server names present
            expect(screen.queryByText("filesystem")).toBeNull()
        })
    })

    describe("summarizeConfig", () => {
        it("shows command + args for stdio transport", () => {
            renderWithQuery(<McpServersTable servers={[mcpServerStdio]} />)
            expect(screen.getByText(/npx -y @modelcontextprotocol\/server-filesystem \/data/)).toBeInTheDocument()
        })

        it("shows url for http transport", () => {
            renderWithQuery(<McpServersTable servers={[mcpServerHttp]} />)
            expect(screen.getByText("https://mcp.example.com/sse")).toBeInTheDocument()
        })
    })

    describe("HealthCell", () => {
        it("shows tool count with 'ok' status", () => {
            renderWithQuery(<McpServersTable servers={[mcpServerStdio]} />)
            // tools_cache has 2 tools
            expect(screen.getByText(/2 tools/)).toBeInTheDocument()
        })

        it("shows singular 'tool' for exactly 1 tool", () => {
            const oneToolServer = {
                ...mcpServerStdio,
                id: "mcp-x",
                tools_cache: [mcpServerStdio.tools_cache![0]],
            }
            renderWithQuery(<McpServersTable servers={[oneToolServer]} />)
            expect(screen.getByText(/1 tool$/)).toBeInTheDocument()
        })

        it("shows 'Failed' for error status with tooltip title", () => {
            renderWithQuery(<McpServersTable servers={[mcpServerHttp]} />)
            expect(screen.getByText("Failed")).toBeInTheDocument()
            const failedEl = screen.getByText("Failed")
            expect(failedEl.closest("[title]")).toHaveAttribute("title", "connect ECONNREFUSED")
        })

        it("shows 'Checking…' spinner for null status", () => {
            renderWithQuery(<McpServersTable servers={[mcpServerUnchecked]} />)
            expect(screen.getByText("Checking…")).toBeInTheDocument()
        })
    })

    describe("enable/disable Switch", () => {
        it("calls update.mutate with toggled enabled value when switch clicked", async () => {
            const { update } = setup()
            const user = userEvent.setup()
            renderWithQuery(<McpServersTable servers={[mcpServerStdio]} onEdit={vi.fn()} />)
            const sw = screen.getByRole("switch", { name: /disable|enable/i })
            await user.click(sw)
            expect(update.mutate).toHaveBeenCalledWith({
                id: mcpServerStdio.id,
                data: { enabled: false },
            })
        })

        it("does NOT call onSelect when switch is clicked (stopPropagation)", async () => {
            const onSelect = vi.fn()
            const user = userEvent.setup()
            renderWithQuery(
                <McpServersTable servers={[mcpServerStdio]} onSelect={onSelect} onEdit={vi.fn()} />
            )
            const sw = screen.getByRole("switch", { name: /disable|enable/i })
            await user.click(sw)
            expect(onSelect).not.toHaveBeenCalled()
        })
    })

    describe("re-check button", () => {
        it("calls check.mutate with server id", async () => {
            const { check } = setup()
            const user = userEvent.setup()
            renderWithQuery(<McpServersTable servers={[mcpServerStdio]} onEdit={vi.fn()} />)
            await user.click(screen.getByTitle("Re-check connection"))
            expect(check.mutate).toHaveBeenCalledWith(mcpServerStdio.id)
        })

        it("is disabled while isPendingId is true for that server", () => {
            setup({ pendingIds: [mcpServerStdio.id] })
            renderWithQuery(<McpServersTable servers={[mcpServerStdio]} onEdit={vi.fn()} />)
            expect(screen.getByTitle("Re-check connection")).toBeDisabled()
        })

        it("is not rendered when onEdit is not provided", () => {
            renderWithQuery(<McpServersTable servers={[mcpServerStdio]} />)
            expect(screen.queryByTitle("Re-check connection")).toBeNull()
        })
    })

    describe("Edit / Delete buttons", () => {
        it("calls onEdit and does NOT call onSelect when Edit clicked", async () => {
            const onEdit = vi.fn()
            const onSelect = vi.fn()
            const user = userEvent.setup()
            renderWithQuery(<McpServersTable servers={[mcpServerStdio]} onEdit={onEdit} onSelect={onSelect} />)
            await user.click(screen.getByTitle("Edit"))
            expect(onEdit).toHaveBeenCalledWith(mcpServerStdio)
            expect(onSelect).not.toHaveBeenCalled()
        })

        it("calls onDelete and does NOT call onSelect when Delete clicked", async () => {
            const onDelete = vi.fn()
            const onSelect = vi.fn()
            const user = userEvent.setup()
            renderWithQuery(
                <McpServersTable servers={[mcpServerStdio]} onDelete={onDelete} onSelect={onSelect} />
            )
            await user.click(screen.getByTitle("Delete"))
            expect(onDelete).toHaveBeenCalledWith(mcpServerStdio)
            expect(onSelect).not.toHaveBeenCalled()
        })
    })

    describe("row click / selection", () => {
        it("calls onSelect when row is clicked", async () => {
            const onSelect = vi.fn()
            const user = userEvent.setup()
            renderWithQuery(<McpServersTable servers={[mcpServerStdio]} onSelect={onSelect} />)
            await user.click(screen.getByText("filesystem"))
            expect(onSelect).toHaveBeenCalledWith(mcpServerStdio)
        })

        it("applies selected class when selectedId matches", () => {
            renderWithQuery(
                <McpServersTable servers={[mcpServerStdio]} onSelect={vi.fn()} selectedId={mcpServerStdio.id} />
            )
            const row = screen.getByText("filesystem").closest("tr")
            expect(row).toHaveClass("bg-muted/60")
        })

        it("applies opacity-60 for disabled server", () => {
            const disabled = { ...mcpServerStdio, id: "mcp-dis", enabled: false }
            renderWithQuery(<McpServersTable servers={[disabled]} onSelect={vi.fn()} />)
            const row = screen.getByText("filesystem").closest("tr")
            expect(row).toHaveClass("opacity-60")
        })
    })

    describe("useCheck onSuccess/onError toasts", () => {
        it("toasts success with tool count on ok status", () => {
            setup()
            renderWithQuery(<McpServersTable servers={[mcpServerStdio]} />)
            const opts = vi.mocked(mcpServers.useCheck).mock.calls[0]?.[0] as
                | { onSuccess: (s: typeof mcpServerStdio) => void }
                | undefined
            opts?.onSuccess(mcpServerStdio)
            expect(toast.success).toHaveBeenCalledWith("filesystem: 2 tools")
        })

        it("toasts success with '0 tools' when tools_cache is null on ok status", () => {
            setup()
            renderWithQuery(<McpServersTable servers={[mcpServerStdio]} />)
            const opts = vi.mocked(mcpServers.useCheck).mock.calls[0]?.[0] as
                | { onSuccess: (s: typeof mcpServerStdio) => void }
                | undefined
            const serverNullCache = { ...mcpServerStdio, tools_cache: null }
            opts?.onSuccess(serverNullCache as typeof mcpServerStdio)
            expect(toast.success).toHaveBeenCalledWith("filesystem: 0 tools")
        })

        it("toasts error on check error status", () => {
            setup()
            renderWithQuery(<McpServersTable servers={[mcpServerHttp]} />)
            const opts = vi.mocked(mcpServers.useCheck).mock.calls[0]?.[0] as
                | { onSuccess: (s: typeof mcpServerHttp) => void }
                | undefined
            opts?.onSuccess(mcpServerHttp)
            expect(toast.error).toHaveBeenCalledWith("remote-http: connect ECONNREFUSED")
        })

        it("uses 'check failed' fallback when last_check_error is null", () => {
            setup()
            renderWithQuery(<McpServersTable servers={[mcpServerStdio]} />)
            const opts = vi.mocked(mcpServers.useCheck).mock.calls[0]?.[0] as
                | { onSuccess: (s: typeof mcpServerStdio) => void }
                | undefined
            const serverNoError = { ...mcpServerStdio, last_check_status: "error" as const, last_check_error: null }
            opts?.onSuccess(serverNoError)
            expect(toast.error).toHaveBeenCalledWith("filesystem: check failed")
        })

        it("toasts error via useCheck onError", () => {
            setup()
            renderWithQuery(<McpServersTable servers={[mcpServerStdio]} />)
            const opts = vi.mocked(mcpServers.useCheck).mock.calls[0]?.[0] as
                | { onError: (e: Error) => void }
                | undefined
            opts?.onError(new Error("Network error"))
            expect(toast.error).toHaveBeenCalledWith("Network error")
        })

        it("toasts 'Check failed' fallback when useCheck onError has empty message", () => {
            setup()
            renderWithQuery(<McpServersTable servers={[mcpServerStdio]} />)
            const opts = vi.mocked(mcpServers.useCheck).mock.calls[0]?.[0] as
                | { onError: (e: Error) => void }
                | undefined
            opts?.onError(new Error(""))
            expect(toast.error).toHaveBeenCalledWith("Check failed")
        })

        it("toasts 'Update failed' fallback when useUpdate onError has empty message", () => {
            setup()
            renderWithQuery(<McpServersTable servers={[mcpServerStdio]} onEdit={vi.fn()} />)
            const opts = vi.mocked(mcpServers.useUpdate).mock.calls[0]?.[0] as
                | { onError: (e: Error) => void }
                | undefined
            opts?.onError(new Error(""))
            expect(toast.error).toHaveBeenCalledWith("Update failed")
        })
    })
})
