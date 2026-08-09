import { describe, it, expect, vi, beforeEach } from "vitest"
import { screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { toast } from "sonner"

import { McpServerDetailsSheet } from "@/components/tools/mcp-details-sheet"
import { renderWithQuery } from "./_render"
import { mcpServerStdio, mcpServerHttp, mcpServerUnchecked, mcpRuntimeConnected } from "./_fixtures"
import { makeQuery, makeMutation } from "./_mocks"
import { mcpServers } from "@/lib/api/mcp"
import type { McpCheckPhase } from "@/lib/api/mcp"

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

type CheckState = {
    run: ReturnType<typeof vi.fn>
    cancel: ReturnType<typeof vi.fn>
    reset: ReturnType<typeof vi.fn>
    phase: McpCheckPhase | null
    logs: string[]
    isChecking: boolean
    error: string | null
    result: typeof mcpServerStdio | null
}

function makeCheckState(overrides: Partial<CheckState> = {}): CheckState {
    return {
        run: vi.fn(),
        cancel: vi.fn(),
        reset: vi.fn(),
        phase: null,
        logs: [],
        isChecking: false,
        error: null,
        result: null,
        ...overrides,
    }
}

function setupMocks(checkState?: CheckState) {
    const cs = checkState ?? makeCheckState()
    vi.mocked(mcpServers.useCheckStream).mockImplementation(() => cs as any)
    vi.mocked(mcpServers.useRuntime).mockReturnValue(makeQuery({ data: undefined }) as ReturnType<typeof makeQuery>)
    vi.mocked(mcpServers.useStop).mockReturnValue(makeMutation() as ReturnType<typeof makeMutation>)
    vi.mocked(mcpServers.useRestart).mockReturnValue(makeMutation() as ReturnType<typeof makeMutation>)
    return cs
}

describe("McpServerDetailsSheet", () => {
    beforeEach(() => setupMocks())

    describe("null server guard", () => {
        it("renders nothing when server is null", () => {
            const { container } = renderWithQuery(
                <McpServerDetailsSheet server={null} open onOpenChange={vi.fn()} isAdmin />
            )
            // Sheet won't mount
            expect(container.firstChild).toBeNull()
        })
    })

    describe("header", () => {
        it("shows server name and transport badge", () => {
            renderWithQuery(
                <McpServerDetailsSheet server={mcpServerStdio} open onOpenChange={vi.fn()} isAdmin />
            )
            expect(screen.getByText("filesystem")).toBeInTheDocument()
            expect(screen.getByText("stdio")).toBeInTheDocument()
        })

        it("shows 'disabled' badge when server.enabled is false", () => {
            const disabled = { ...mcpServerStdio, enabled: false }
            renderWithQuery(
                <McpServerDetailsSheet server={disabled} open onOpenChange={vi.fn()} isAdmin />
            )
            expect(screen.getByText("disabled")).toBeInTheDocument()
        })

        it("does NOT show 'disabled' badge when server is enabled", () => {
            renderWithQuery(
                <McpServerDetailsSheet server={mcpServerStdio} open onOpenChange={vi.fn()} isAdmin />
            )
            expect(screen.queryByText("disabled")).toBeNull()
        })
    })

    describe("ServerInfoSection wiring", () => {
        it("renders ServerInfoSection when server.server_info is set", () => {
            renderWithQuery(
                <McpServerDetailsSheet server={mcpServerStdio} open onOpenChange={vi.fn()} isAdmin />
            )
            // server_info.name = "fs-server"
            expect(screen.getByText(/fs-server/)).toBeInTheDocument()
        })

        it("does NOT render Server heading when server_info is null", () => {
            renderWithQuery(
                <McpServerDetailsSheet server={mcpServerUnchecked} open onOpenChange={vi.fn()} isAdmin />
            )
            // mcpServerUnchecked has server_info: null, so "Server" section won't appear
            // No "fs-server" text
            expect(screen.queryByText(/fs-server/)).toBeNull()
        })
    })

    describe("stop / restart buttons", () => {
        it("Stop button calls stop.mutate with server id", async () => {
            const stopMut = makeMutation()
            vi.mocked(mcpServers.useStop).mockReturnValue(stopMut as ReturnType<typeof makeMutation>)
            // Need runtime in connected state so Stop button is NOT disabled
            vi.mocked(mcpServers.useRuntime).mockReturnValue(makeQuery({ data: mcpRuntimeConnected }) as ReturnType<typeof makeQuery>)
            const user = userEvent.setup()
            renderWithQuery(
                <McpServerDetailsSheet server={mcpServerStdio} open onOpenChange={vi.fn()} isAdmin />
            )
            await user.click(screen.getByRole("button", { name: /stop/i }))
            expect(stopMut.mutate).toHaveBeenCalledWith(mcpServerStdio.id)
        })

        it("Restart button calls restart.mutate with server id", async () => {
            const restartMut = makeMutation()
            vi.mocked(mcpServers.useRestart).mockReturnValue(restartMut as ReturnType<typeof makeMutation>)
            const user = userEvent.setup()
            renderWithQuery(
                <McpServerDetailsSheet server={mcpServerStdio} open onOpenChange={vi.fn()} isAdmin />
            )
            await user.click(screen.getByRole("button", { name: /restart/i }))
            expect(restartMut.mutate).toHaveBeenCalledWith(mcpServerStdio.id)
        })

        it("toasts success with restart result on ok status", () => {
            setupMocks()
            renderWithQuery(
                <McpServerDetailsSheet server={mcpServerStdio} open onOpenChange={vi.fn()} isAdmin />
            )
            const opts = vi.mocked(mcpServers.useRestart).mock.calls[0]?.[0] as
                | { onSuccess: (s: typeof mcpServerStdio) => void }
                | undefined
            opts?.onSuccess(mcpServerStdio) // last_check_status="ok", tools_cache has 2 tools
            expect(toast.success).toHaveBeenCalledWith("Restarted — 2 tools")
        })

        it("toasts error when restart result status is error", () => {
            setupMocks()
            renderWithQuery(
                <McpServerDetailsSheet server={mcpServerStdio} open onOpenChange={vi.fn()} isAdmin />
            )
            const opts = vi.mocked(mcpServers.useRestart).mock.calls[0]?.[0] as
                | { onSuccess: (s: typeof mcpServerStdio) => void }
                | undefined
            const failedServer = { ...mcpServerStdio, last_check_status: "error" as const, last_check_error: "spawn failed\nstacktrace" }
            opts?.onSuccess(failedServer)
            expect(toast.error).toHaveBeenCalledWith("Restart failed: spawn failed")
        })

        it("toasts error via useRestart onError", () => {
            setupMocks()
            renderWithQuery(
                <McpServerDetailsSheet server={mcpServerStdio} open onOpenChange={vi.fn()} isAdmin />
            )
            const opts = vi.mocked(mcpServers.useRestart).mock.calls[0]?.[0] as
                | { onError: (e: Error) => void }
                | undefined
            opts?.onError(new Error("restart error"))
            expect(toast.error).toHaveBeenCalledWith("restart error")
        })

        it("toasts 'Stop failed' fallback when useStop onError has empty message", () => {
            setupMocks()
            renderWithQuery(
                <McpServerDetailsSheet server={mcpServerStdio} open onOpenChange={vi.fn()} isAdmin />
            )
            const opts = vi.mocked(mcpServers.useStop).mock.calls[0]?.[0] as
                | { onError: (e: Error) => void }
                | undefined
            opts?.onError(new Error(""))
            expect(toast.error).toHaveBeenCalledWith("Stop failed")
        })

        it("toasts 'Restart failed' fallback when useRestart onError has empty message", () => {
            setupMocks()
            renderWithQuery(
                <McpServerDetailsSheet server={mcpServerStdio} open onOpenChange={vi.fn()} isAdmin />
            )
            const opts = vi.mocked(mcpServers.useRestart).mock.calls[0]?.[0] as
                | { onError: (e: Error) => void }
                | undefined
            opts?.onError(new Error(""))
            expect(toast.error).toHaveBeenCalledWith("Restart failed")
        })

        it("toasts 'Stopped' on useStop onSuccess", () => {
            setupMocks()
            renderWithQuery(
                <McpServerDetailsSheet server={mcpServerStdio} open onOpenChange={vi.fn()} isAdmin />
            )
            const opts = vi.mocked(mcpServers.useStop).mock.calls[0]?.[0] as
                | { onSuccess: () => void }
                | undefined
            opts?.onSuccess()
            expect(toast.success).toHaveBeenCalledWith("Stopped")
        })

        it("toasts error via useStop onError", () => {
            setupMocks()
            renderWithQuery(
                <McpServerDetailsSheet server={mcpServerStdio} open onOpenChange={vi.fn()} isAdmin />
            )
            const opts = vi.mocked(mcpServers.useStop).mock.calls[0]?.[0] as
                | { onError: (e: Error) => void }
                | undefined
            opts?.onError(new Error("kill failed"))
            expect(toast.error).toHaveBeenCalledWith("kill failed")
        })
    })

    describe("Re-check button", () => {
        it("calls check.run with server id when Re-check clicked", async () => {
            const cs = makeCheckState()
            vi.mocked(mcpServers.useCheckStream).mockImplementation(() => cs as any)
            vi.mocked(mcpServers.useRuntime).mockReturnValue(makeQuery({ data: undefined }) as ReturnType<typeof makeQuery>)
            vi.mocked(mcpServers.useStop).mockReturnValue(makeMutation() as ReturnType<typeof makeMutation>)
            vi.mocked(mcpServers.useRestart).mockReturnValue(makeMutation() as ReturnType<typeof makeMutation>)
            const user = userEvent.setup()
            renderWithQuery(
                <McpServerDetailsSheet server={mcpServerStdio} open onOpenChange={vi.fn()} isAdmin />
            )
            await user.click(screen.getByRole("button", { name: /re-check/i }))
            expect(cs.run).toHaveBeenCalledWith(mcpServerStdio.id)
        })
    })

    describe("check stream state machine via rerender", () => {
        it("shows phase label while isChecking", () => {
            let cs = makeCheckState()
            vi.mocked(mcpServers.useCheckStream).mockImplementation(() => cs as any)
            vi.mocked(mcpServers.useRuntime).mockReturnValue(makeQuery({ data: undefined }) as ReturnType<typeof makeQuery>)
            vi.mocked(mcpServers.useStop).mockReturnValue(makeMutation() as ReturnType<typeof makeMutation>)
            vi.mocked(mcpServers.useRestart).mockReturnValue(makeMutation() as ReturnType<typeof makeMutation>)
            const utils = renderWithQuery(
                <McpServerDetailsSheet server={mcpServerStdio} open onOpenChange={vi.fn()} isAdmin />
            )
            // Simulate spawning phase
            cs = makeCheckState({ isChecking: true, phase: "spawning", logs: ["[info] spawning"] })
            vi.mocked(mcpServers.useCheckStream).mockImplementation(() => cs as any)
            utils.rerender(
                <McpServerDetailsSheet server={mcpServerStdio} open onOpenChange={vi.fn()} isAdmin />
            )
            // PHASE_LABELS["spawning"] = "Spawning…" — check for the exact label string
            expect(screen.getByText("Spawning…")).toBeInTheDocument()
        })

        it("toasts success when check.result has status=ok", () => {
            let cs = makeCheckState()
            vi.mocked(mcpServers.useCheckStream).mockImplementation(() => cs as any)
            vi.mocked(mcpServers.useRuntime).mockReturnValue(makeQuery({ data: undefined }) as ReturnType<typeof makeQuery>)
            vi.mocked(mcpServers.useStop).mockReturnValue(makeMutation() as ReturnType<typeof makeMutation>)
            vi.mocked(mcpServers.useRestart).mockReturnValue(makeMutation() as ReturnType<typeof makeMutation>)
            const utils = renderWithQuery(
                <McpServerDetailsSheet server={mcpServerStdio} open onOpenChange={vi.fn()} isAdmin />
            )
            // Set result to ok server
            cs = makeCheckState({ result: mcpServerStdio })
            vi.mocked(mcpServers.useCheckStream).mockImplementation(() => cs as any)
            utils.rerender(
                <McpServerDetailsSheet server={mcpServerStdio} open onOpenChange={vi.fn()} isAdmin />
            )
            expect(toast.success).toHaveBeenCalledWith("Check passed — 2 tools")
        })

        it("toasts error when check.result has status=error", () => {
            let cs = makeCheckState()
            vi.mocked(mcpServers.useCheckStream).mockImplementation(() => cs as any)
            vi.mocked(mcpServers.useRuntime).mockReturnValue(makeQuery({ data: undefined }) as ReturnType<typeof makeQuery>)
            vi.mocked(mcpServers.useStop).mockReturnValue(makeMutation() as ReturnType<typeof makeMutation>)
            vi.mocked(mcpServers.useRestart).mockReturnValue(makeMutation() as ReturnType<typeof makeMutation>)
            const utils = renderWithQuery(
                <McpServerDetailsSheet server={mcpServerStdio} open onOpenChange={vi.fn()} isAdmin />
            )
            const failedServer = { ...mcpServerStdio, last_check_status: "error" as const, last_check_error: "ENOENT\nstacktrace" }
            cs = makeCheckState({ result: failedServer })
            vi.mocked(mcpServers.useCheckStream).mockImplementation(() => cs as any)
            utils.rerender(
                <McpServerDetailsSheet server={mcpServerStdio} open onOpenChange={vi.fn()} isAdmin />
            )
            expect(toast.error).toHaveBeenCalledWith("Check failed: ENOENT")
        })

        it("toasts error when check.error is set without result", () => {
            let cs = makeCheckState()
            vi.mocked(mcpServers.useCheckStream).mockImplementation(() => cs as any)
            vi.mocked(mcpServers.useRuntime).mockReturnValue(makeQuery({ data: undefined }) as ReturnType<typeof makeQuery>)
            vi.mocked(mcpServers.useStop).mockReturnValue(makeMutation() as ReturnType<typeof makeMutation>)
            vi.mocked(mcpServers.useRestart).mockReturnValue(makeMutation() as ReturnType<typeof makeMutation>)
            const utils = renderWithQuery(
                <McpServerDetailsSheet server={mcpServerStdio} open onOpenChange={vi.fn()} isAdmin />
            )
            cs = makeCheckState({ error: "Network timeout" })
            vi.mocked(mcpServers.useCheckStream).mockImplementation(() => cs as any)
            utils.rerender(
                <McpServerDetailsSheet server={mcpServerStdio} open onOpenChange={vi.fn()} isAdmin />
            )
            expect(toast.error).toHaveBeenCalledWith("Network timeout")
        })
    })

    describe("silent backfill", () => {
        it("auto-calls check.run on mount when server_info=null and status=ok", () => {
            const cs = makeCheckState()
            vi.mocked(mcpServers.useCheckStream).mockImplementation(() => cs as any)
            vi.mocked(mcpServers.useRuntime).mockReturnValue(makeQuery({ data: undefined }) as ReturnType<typeof makeQuery>)
            vi.mocked(mcpServers.useStop).mockReturnValue(makeMutation() as ReturnType<typeof makeMutation>)
            vi.mocked(mcpServers.useRestart).mockReturnValue(makeMutation() as ReturnType<typeof makeMutation>)
            const backfillServer = { ...mcpServerStdio, server_info: null }
            renderWithQuery(
                <McpServerDetailsSheet server={backfillServer} open onOpenChange={vi.fn()} isAdmin />
            )
            expect(cs.run).toHaveBeenCalledWith(mcpServerStdio.id)
        })

        it("does NOT auto-call check.run when server_info is present", () => {
            const cs = makeCheckState()
            vi.mocked(mcpServers.useCheckStream).mockImplementation(() => cs as any)
            vi.mocked(mcpServers.useRuntime).mockReturnValue(makeQuery({ data: undefined }) as ReturnType<typeof makeQuery>)
            vi.mocked(mcpServers.useStop).mockReturnValue(makeMutation() as ReturnType<typeof makeMutation>)
            vi.mocked(mcpServers.useRestart).mockReturnValue(makeMutation() as ReturnType<typeof makeMutation>)
            renderWithQuery(
                <McpServerDetailsSheet server={mcpServerStdio} open onOpenChange={vi.fn()} isAdmin />
            )
            expect(cs.run).not.toHaveBeenCalled()
        })
    })

    describe("reset stream state on server switch", () => {
        it("calls check.cancel and check.reset when switching to a different server", () => {
            const cs = makeCheckState()
            vi.mocked(mcpServers.useCheckStream).mockImplementation(() => cs as any)
            vi.mocked(mcpServers.useRuntime).mockReturnValue(makeQuery({ data: undefined }) as ReturnType<typeof makeQuery>)
            vi.mocked(mcpServers.useStop).mockReturnValue(makeMutation() as ReturnType<typeof makeMutation>)
            vi.mocked(mcpServers.useRestart).mockReturnValue(makeMutation() as ReturnType<typeof makeMutation>)
            const utils = renderWithQuery(
                <McpServerDetailsSheet server={mcpServerStdio} open onOpenChange={vi.fn()} isAdmin />
            )
            // Switch to a different server (mcpServerHttp) - this fires lastSheetIdRef effect
            utils.rerender(
                <McpServerDetailsSheet server={mcpServerHttp} open onOpenChange={vi.fn()} isAdmin />
            )
            expect(cs.cancel).toHaveBeenCalled()
            expect(cs.reset).toHaveBeenCalled()
        })
    })

    describe("sections wiring - endpoint and tools", () => {
        it("shows endpoint command for stdio server", () => {
            renderWithQuery(
                <McpServerDetailsSheet server={mcpServerStdio} open onOpenChange={vi.fn()} isAdmin />
            )
            // "$ " is in a span and "npx" is a sibling text node — check via body textContent
            expect(document.body.textContent).toContain("npx")
        })

        it("shows tools count from tools_cache", () => {
            renderWithQuery(
                <McpServerDetailsSheet server={mcpServerStdio} open onOpenChange={vi.fn()} isAdmin />
            )
            // Tools from tools_cache should be visible by their names
            expect(screen.getByText("read_file")).toBeInTheDocument()
            expect(screen.getByText("write_file")).toBeInTheDocument()
        })
    })
})
