import { describe, it, expect, vi, beforeEach } from "vitest"
import { screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { toast } from "sonner"

import { McpFormDialog } from "@/components/tools/mcp-form-dialog"
import { renderWithQuery } from "./_render"
import { mcpServerStdio, mcpServerHttp, mcpServerDecryptFailed, mcpPresetStdio, mcpPresetHttp } from "./_fixtures"
import { makeMutation } from "./_mocks"
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

function setup() {
    const createMut = makeMutation()
    const updateMut = makeMutation()
    vi.mocked(mcpServers.useCreate).mockReturnValue(createMut as ReturnType<typeof makeMutation>)
    vi.mocked(mcpServers.useUpdate).mockReturnValue(updateMut as ReturnType<typeof makeMutation>)
    return { createMut, updateMut }
}

describe("McpFormDialog", () => {
    beforeEach(() => setup())

    describe("create mode defaults", () => {
        it("shows 'Add MCP server' title", () => {
            renderWithQuery(<McpFormDialog open mode="create" onOpenChange={vi.fn()} />)
            expect(screen.getByText("Add MCP server")).toBeInTheDocument()
        })

        it("starts with stdio tab active and empty fields", () => {
            renderWithQuery(<McpFormDialog open mode="create" onOpenChange={vi.fn()} />)
            expect(screen.getByRole("textbox", { name: /command/i })).toBeInTheDocument()
            expect((screen.getByRole("textbox", { name: /^name/i }) as HTMLInputElement).value).toBe("")
        })

        it("shows empty command for stdio", () => {
            renderWithQuery(<McpFormDialog open mode="create" onOpenChange={vi.fn()} />)
            expect((screen.getByRole("textbox", { name: /command/i }) as HTMLInputElement).value).toBe("")
        })
    })

    describe("edit mode - stdio", () => {
        it("pre-fills name, description, command, args, env from mcpServerStdio", () => {
            renderWithQuery(
                <McpFormDialog open mode="edit" server={mcpServerStdio} onOpenChange={vi.fn()} />
            )
            expect((screen.getByRole("textbox", { name: /^name/i }) as HTMLInputElement).value).toBe("filesystem")
            expect((screen.getByRole("textbox", { name: /^description/i }) as HTMLInputElement).value).toBe("Local filesystem access")
            expect((screen.getByRole("textbox", { name: /command/i }) as HTMLInputElement).value).toBe("npx")
            const argsTA = screen.getByRole("textbox", { name: /args/i }) as HTMLTextAreaElement
            expect(argsTA.value).toContain("-y")
            expect(argsTA.value).toContain("@modelcontextprotocol/server-filesystem")
        })

        it("shows env as pretty JSON", () => {
            renderWithQuery(
                <McpFormDialog open mode="edit" server={mcpServerStdio} onOpenChange={vi.fn()} />
            )
            const envTA = screen.getByRole("textbox", { name: /^env/i }) as HTMLTextAreaElement
            expect(envTA.value).toContain("TOKEN")
        })
    })

    describe("edit mode - http", () => {
        it("pre-fills url from mcpServerHttp", () => {
            renderWithQuery(
                <McpFormDialog open mode="edit" server={mcpServerHttp} onOpenChange={vi.fn()} />
            )
            expect((screen.getByRole("textbox", { name: /url/i }) as HTMLInputElement).value).toBe(
                "https://mcp.example.com/sse"
            )
        })

        it("pre-fills headers as pretty JSON", () => {
            renderWithQuery(
                <McpFormDialog open mode="edit" server={mcpServerHttp} onOpenChange={vi.fn()} />
            )
            const headersTA = screen.getByRole("textbox", { name: /headers/i }) as HTMLTextAreaElement
            expect(headersTA.value).toContain("Authorization")
        })
    })

    describe("preset fill flow", () => {
        it("pre-fills form with stdio preset data in create mode", () => {
            renderWithQuery(
                <McpFormDialog open mode="create" preset={mcpPresetStdio} onOpenChange={vi.fn()} />
            )
            expect((screen.getByRole("textbox", { name: /^name/i }) as HTMLInputElement).value).toBe("Filesystem")
            expect((screen.getByRole("textbox", { name: /command/i }) as HTMLInputElement).value).toBe("npx")
        })

        it("pre-fills args from preset", () => {
            renderWithQuery(
                <McpFormDialog open mode="create" preset={mcpPresetStdio} onOpenChange={vi.fn()} />
            )
            const argsTA = screen.getByRole("textbox", { name: /args/i }) as HTMLTextAreaElement
            expect(argsTA.value).toContain("-y")
            expect(argsTA.value).toContain("@modelcontextprotocol/server-filesystem")
        })

        it("pre-fills http preset and shows http transport tab active", () => {
            renderWithQuery(
                <McpFormDialog open mode="create" preset={mcpPresetHttp} onOpenChange={vi.fn()} />
            )
            expect((screen.getByRole("textbox", { name: /^name/i }) as HTMLInputElement).value).toBe("Remote API")
            // http transport → URL field visible, not command
            expect(screen.getByRole("textbox", { name: /url/i })).toBeInTheDocument()
            expect(screen.queryByRole("textbox", { name: /command/i })).toBeNull()
        })
    })

    describe("transport tab switching", () => {
        it("shows http fields after clicking http tab", async () => {
            const user = userEvent.setup()
            renderWithQuery(<McpFormDialog open mode="create" onOpenChange={vi.fn()} />)
            // Initially stdio tab active - http tab trigger present
            const httpTab = screen.getByRole("tab", { name: /http/i })
            await user.click(httpTab)
            expect(screen.getByRole("textbox", { name: /url/i })).toBeInTheDocument()
            expect(screen.queryByRole("textbox", { name: /command/i })).toBeNull()
        })

        it("shows stdio fields after switching back", async () => {
            const user = userEvent.setup()
            renderWithQuery(<McpFormDialog open mode="create" onOpenChange={vi.fn()} />)
            await user.click(screen.getByRole("tab", { name: /http/i }))
            await user.click(screen.getByRole("tab", { name: /stdio/i }))
            expect(screen.getByRole("textbox", { name: /command/i })).toBeInTheDocument()
            expect(screen.queryByRole("textbox", { name: /url/i })).toBeNull()
        })
    })

    describe("validation", () => {
        it("Save disabled when name is empty (nameError)", () => {
            renderWithQuery(<McpFormDialog open mode="create" onOpenChange={vi.fn()} />)
            expect(screen.getByRole("button", { name: /save/i })).toBeDisabled()
        })

        it("Save disabled when command is empty for stdio (targetError)", async () => {
            const user = userEvent.setup()
            renderWithQuery(<McpFormDialog open mode="create" onOpenChange={vi.fn()} />)
            await user.type(screen.getByRole("textbox", { name: /^name/i }), "test-server")
            // command still empty
            expect(screen.getByRole("button", { name: /save/i })).toBeDisabled()
        })

        it("Save disabled and shows error when env JSON is invalid", async () => {
            const user = userEvent.setup()
            renderWithQuery(<McpFormDialog open mode="create" onOpenChange={vi.fn()} />)
            await user.type(screen.getByRole("textbox", { name: /^name/i }), "test-server")
            await user.type(screen.getByRole("textbox", { name: /command/i }), "npx")
            const envTA = screen.getByRole("textbox", { name: /^env/i })
            await user.clear(envTA)
            await user.type(envTA, "not json")
            expect(screen.getByRole("button", { name: /save/i })).toBeDisabled()
        })

        it("Save disabled when url is empty for http (targetError)", async () => {
            const user = userEvent.setup()
            renderWithQuery(<McpFormDialog open mode="create" onOpenChange={vi.fn()} />)
            await user.type(screen.getByRole("textbox", { name: /^name/i }), "test-server")
            await user.click(screen.getByRole("tab", { name: /http/i }))
            // url still empty
            expect(screen.getByRole("button", { name: /save/i })).toBeDisabled()
        })

        it("Save disabled and headers error shown for invalid headers JSON", async () => {
            const user = userEvent.setup()
            renderWithQuery(<McpFormDialog open mode="create" onOpenChange={vi.fn()} />)
            await user.type(screen.getByRole("textbox", { name: /^name/i }), "test-server")
            await user.click(screen.getByRole("tab", { name: /http/i }))
            await user.type(screen.getByRole("textbox", { name: /url/i }), "https://example.com")
            const headersTA = screen.getByRole("textbox", { name: /headers/i })
            await user.clear(headersTA)
            await user.type(headersTA, "not json")
            expect(screen.getByRole("button", { name: /save/i })).toBeDisabled()
        })
    })

    describe("decryption failed guard", () => {
        it("shows Secrets unreadable warning banner", () => {
            renderWithQuery(
                <McpFormDialog open mode="edit" server={mcpServerDecryptFailed} onOpenChange={vi.fn()} />
            )
            expect(screen.getByText("Secrets unreadable")).toBeInTheDocument()
        })

        it("Save button is disabled when decryption failed", () => {
            renderWithQuery(
                <McpFormDialog open mode="edit" server={mcpServerDecryptFailed} onOpenChange={vi.fn()} />
            )
            expect(screen.getByRole("button", { name: /save/i })).toBeDisabled()
        })

        it("does NOT call updateMutation.mutate when decryption failed", async () => {
            const { updateMut } = setup()
            const user = userEvent.setup()
            renderWithQuery(
                <McpFormDialog open mode="edit" server={mcpServerDecryptFailed} onOpenChange={vi.fn()} />
            )
            await user.click(screen.getByRole("button", { name: /save/i }))
            expect(updateMut.mutate).not.toHaveBeenCalled()
        })
    })

    describe("valid create submit", () => {
        it("calls createMutation.mutate with correct stdio payload", async () => {
            const { createMut } = setup()
            const user = userEvent.setup()
            renderWithQuery(<McpFormDialog open mode="create" onOpenChange={vi.fn()} />)
            await user.type(screen.getByRole("textbox", { name: /^name/i }), "my-server")
            await user.type(screen.getByRole("textbox", { name: /command/i }), "npx")
            const argsTA = screen.getByRole("textbox", { name: /args/i })
            await user.type(argsTA, "-y\nsome-package")
            await user.click(screen.getByRole("button", { name: /save/i }))
            expect(createMut.mutate).toHaveBeenCalledWith(
                expect.objectContaining({
                    name: "my-server",
                    transport: "stdio",
                    config: expect.objectContaining({
                        command: "npx",
                        args: ["-y", "some-package"],
                        env: {},
                    }),
                })
            )
        })

        it("omits cwd from payload when blank", async () => {
            const { createMut } = setup()
            const user = userEvent.setup()
            renderWithQuery(<McpFormDialog open mode="create" onOpenChange={vi.fn()} />)
            await user.type(screen.getByRole("textbox", { name: /^name/i }), "my-server")
            await user.type(screen.getByRole("textbox", { name: /command/i }), "npx")
            await user.click(screen.getByRole("button", { name: /save/i }))
            const config = (createMut.mutate as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]?.config
            expect(config).not.toHaveProperty("cwd")
        })

        it("includes cwd in payload when set", async () => {
            const { createMut } = setup()
            const user = userEvent.setup()
            renderWithQuery(<McpFormDialog open mode="create" onOpenChange={vi.fn()} />)
            await user.type(screen.getByRole("textbox", { name: /^name/i }), "my-server")
            await user.type(screen.getByRole("textbox", { name: /command/i }), "npx")
            const cwdInput = screen.getByRole("textbox", { name: /cwd/i })
            await user.type(cwdInput, "/home/user/project")
            await user.click(screen.getByRole("button", { name: /save/i }))
            const config = (createMut.mutate as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]?.config
            expect(config).toHaveProperty("cwd", "/home/user/project")
        })

        it("uses empty env object when env textarea is blank", async () => {
            const { createMut } = setup()
            const user = userEvent.setup()
            renderWithQuery(<McpFormDialog open mode="create" onOpenChange={vi.fn()} />)
            await user.type(screen.getByRole("textbox", { name: /^name/i }), "my-server")
            await user.type(screen.getByRole("textbox", { name: /command/i }), "npx")
            // Clear the env textarea so it's empty
            const envTA = screen.getByRole("textbox", { name: /^env/i })
            await user.clear(envTA)
            await user.click(screen.getByRole("button", { name: /save/i }))
            const config = (createMut.mutate as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]?.config
            expect(config.env).toEqual({})
        })

        it("shows JSON object error when env contains a JSON array", async () => {
            const user = userEvent.setup()
            renderWithQuery(<McpFormDialog open mode="create" onOpenChange={vi.fn()} />)
            await user.type(screen.getByRole("textbox", { name: /^name/i }), "my-server")
            await user.type(screen.getByRole("textbox", { name: /command/i }), "npx")
            const envTA = screen.getByRole("textbox", { name: /^env/i })
            await user.clear(envTA)
            await user.type(envTA, "42")
            // "Must be a JSON object" error (number is valid JSON but not an object)
            expect(screen.getByRole("button", { name: /save/i })).toBeDisabled()
        })

        it("calls createMutation.mutate with http payload", async () => {
            const { createMut } = setup()
            const user = userEvent.setup()
            renderWithQuery(<McpFormDialog open mode="create" onOpenChange={vi.fn()} />)
            await user.type(screen.getByRole("textbox", { name: /^name/i }), "http-server")
            await user.click(screen.getByRole("tab", { name: /http/i }))
            await user.type(screen.getByRole("textbox", { name: /url/i }), "https://example.com/mcp")
            await user.click(screen.getByRole("button", { name: /save/i }))
            expect(createMut.mutate).toHaveBeenCalledWith(
                expect.objectContaining({
                    name: "http-server",
                    transport: "http",
                    config: expect.objectContaining({
                        url: "https://example.com/mcp",
                        headers: {},
                    }),
                })
            )
        })
    })

    describe("valid edit submit", () => {
        it("calls updateMutation.mutate with {id, data}", async () => {
            const { updateMut } = setup()
            const user = userEvent.setup()
            renderWithQuery(
                <McpFormDialog open mode="edit" server={mcpServerStdio} onOpenChange={vi.fn()} />
            )
            await user.click(screen.getByRole("button", { name: /save/i }))
            expect(updateMut.mutate).toHaveBeenCalledWith(
                expect.objectContaining({ id: mcpServerStdio.id, data: expect.any(Object) })
            )
        })
    })

    describe("onSaved callback", () => {
        it("calls onSaved with server on success (create)", () => {
            setup()
            const onSaved = vi.fn()
            renderWithQuery(
                <McpFormDialog open mode="create" onOpenChange={vi.fn()} onSaved={onSaved} />
            )
            const opts = vi.mocked(mcpServers.useCreate).mock.calls[0]?.[0] as
                | { onSuccess: (s: typeof mcpServerStdio) => void }
                | undefined
            opts?.onSuccess(mcpServerStdio)
            expect(onSaved).toHaveBeenCalledWith(mcpServerStdio)
        })

        it("toasts 'Saved' and closes on success (create)", () => {
            setup()
            const onOpenChange = vi.fn()
            renderWithQuery(<McpFormDialog open mode="create" onOpenChange={onOpenChange} />)
            const opts = vi.mocked(mcpServers.useCreate).mock.calls[0]?.[0] as
                | { onSuccess: (s: typeof mcpServerStdio) => void }
                | undefined
            opts?.onSuccess(mcpServerStdio)
            expect(toast.success).toHaveBeenCalledWith("Saved")
            expect(onOpenChange).toHaveBeenCalledWith(false)
        })

        it("toasts error message on error (create)", () => {
            setup()
            renderWithQuery(<McpFormDialog open mode="create" onOpenChange={vi.fn()} />)
            const opts = vi.mocked(mcpServers.useCreate).mock.calls[0]?.[0] as
                | { onError: (e: Error) => void }
                | undefined
            opts?.onError(new Error("Server error"))
            expect(toast.error).toHaveBeenCalledWith("Server error")
        })

        it("calls onSaved with server on success (update)", () => {
            setup()
            const onSaved = vi.fn()
            renderWithQuery(
                <McpFormDialog open mode="edit" server={mcpServerStdio} onOpenChange={vi.fn()} onSaved={onSaved} />
            )
            const opts = vi.mocked(mcpServers.useUpdate).mock.calls[0]?.[0] as
                | { onSuccess: (s: typeof mcpServerStdio) => void }
                | undefined
            opts?.onSuccess(mcpServerStdio)
            expect(onSaved).toHaveBeenCalledWith(mcpServerStdio)
        })

        it("toasts 'Saved' and closes on success (update)", () => {
            setup()
            const onOpenChange = vi.fn()
            renderWithQuery(
                <McpFormDialog open mode="edit" server={mcpServerStdio} onOpenChange={onOpenChange} />
            )
            const opts = vi.mocked(mcpServers.useUpdate).mock.calls[0]?.[0] as
                | { onSuccess: (s: typeof mcpServerStdio) => void }
                | undefined
            opts?.onSuccess(mcpServerStdio)
            expect(toast.success).toHaveBeenCalledWith("Saved")
            expect(onOpenChange).toHaveBeenCalledWith(false)
        })

        it("onSaved not called when onSuccess invoked with null server (update)", () => {
            setup()
            const onSaved = vi.fn()
            renderWithQuery(
                <McpFormDialog open mode="edit" server={mcpServerStdio} onOpenChange={vi.fn()} onSaved={onSaved} />
            )
            const opts = vi.mocked(mcpServers.useUpdate).mock.calls[0]?.[0] as
                | { onSuccess: (s: typeof mcpServerStdio | null) => void }
                | undefined
            opts?.onSuccess(null)
            expect(onSaved).not.toHaveBeenCalled()
        })
    })

    describe("enabled switch and cancel", () => {
        it("Cancel button calls onOpenChange(false)", async () => {
            const onOpenChange = vi.fn()
            const user = userEvent.setup()
            renderWithQuery(<McpFormDialog open mode="create" onOpenChange={onOpenChange} />)
            await user.click(screen.getByRole("button", { name: /cancel/i }))
            expect(onOpenChange).toHaveBeenCalledWith(false)
        })
    })

    describe("extra branch coverage", () => {
        it("does nothing when open=false (useEffect early return)", () => {
            const { container } = renderWithQuery(
                <McpFormDialog open={false} mode="create" onOpenChange={vi.fn()} />
            )
            expect(container).toBeTruthy()
        })

        it("toasts 'Save failed' fallback when create onError has empty message", () => {
            setup()
            renderWithQuery(<McpFormDialog open mode="create" onOpenChange={vi.fn()} />)
            const opts = vi.mocked(mcpServers.useCreate).mock.calls[0]?.[0] as
                | { onError: (e: Error) => void }
                | undefined
            opts?.onError(new Error(""))
            expect(toast.error).toHaveBeenCalledWith("Save failed")
        })

        it("toasts 'Save failed' fallback when update onError has empty message", () => {
            setup()
            renderWithQuery(<McpFormDialog open mode="edit" server={mcpServerStdio} onOpenChange={vi.fn()} />)
            const opts = vi.mocked(mcpServers.useUpdate).mock.calls[0]?.[0] as
                | { onError: (e: Error) => void }
                | undefined
            opts?.onError(new Error(""))
            expect(toast.error).toHaveBeenCalledWith("Save failed")
        })

        it("onSaved not called when onSuccess invoked with null server", () => {
            setup()
            const onSaved = vi.fn()
            renderWithQuery(
                <McpFormDialog open mode="create" onOpenChange={vi.fn()} onSaved={onSaved} />
            )
            const opts = vi.mocked(mcpServers.useCreate).mock.calls[0]?.[0] as
                | { onSuccess: (s: typeof mcpServerStdio | null) => void }
                | undefined
            opts?.onSuccess(null)
            expect(onSaved).not.toHaveBeenCalled()
        })

        it("shows loading spinner when createMutation is pending", () => {
            const loadingMut = makeMutation({ isPending: true })
            vi.mocked(mcpServers.useCreate).mockReturnValue(loadingMut as ReturnType<typeof makeMutation>)
            vi.mocked(mcpServers.useUpdate).mockReturnValue(makeMutation() as ReturnType<typeof makeMutation>)
            renderWithQuery(<McpFormDialog open mode="create" onOpenChange={vi.fn()} />)
            // Save button disabled when loading
            expect(screen.getByRole("button", { name: /save/i })).toBeDisabled()
        })

        it("server.enabled=false presets switch to unchecked", () => {
            setup()
            const disabled = { ...mcpServerStdio, enabled: false }
            renderWithQuery(<McpFormDialog open mode="edit" server={disabled} onOpenChange={vi.fn()} />)
            const sw = screen.getByRole("switch", { name: /enabled/i })
            expect(sw).toHaveAttribute("data-state", "unchecked")
        })

        it("server.description=null falls back to empty string", () => {
            setup()
            const noDesc = { ...mcpServerStdio, description: null } as unknown as typeof mcpServerStdio
            renderWithQuery(<McpFormDialog open mode="edit" server={noDesc} onOpenChange={vi.fn()} />)
            const desc = screen.getByRole("textbox", { name: /^description/i }) as HTMLInputElement
            expect(desc.value).toBe("")
        })
    })
})
