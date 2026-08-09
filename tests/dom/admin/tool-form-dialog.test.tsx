import { describe, it, expect, vi, beforeEach } from "vitest"
import { screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { toast } from "sonner"

import { ToolFormDialog } from "@/components/tools/tool-form-dialog"
import { renderWithQuery } from "./_render"
import { tool } from "./_fixtures"
import { makeMutation } from "./_mocks"
import { tools } from "@/lib/api/tools"

vi.mock("@/lib/api/tools", () => ({
    tools: {
        useCreate: vi.fn(),
        useUpdate: vi.fn(),
        list: vi.fn(),
        keys: { all: () => ["tools"], list: () => ["tools", "list"], one: (id: string) => ["tools", id] },
    },
}))

vi.mock("sonner", () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

const DEFAULT_PARAMETERS = `{
  "type": "object",
  "properties": {},
  "required": []
}`

function setup() {
    const createMut = makeMutation()
    const updateMut = makeMutation()
    vi.mocked(tools.useCreate).mockReturnValue(createMut as ReturnType<typeof makeMutation>)
    vi.mocked(tools.useUpdate).mockReturnValue(updateMut as ReturnType<typeof makeMutation>)
    return { createMut, updateMut }
}

describe("ToolFormDialog", () => {
    beforeEach(() => {
        setup()
    })

    describe("create mode", () => {
        it("shows 'Add tool' title", () => {
            renderWithQuery(<ToolFormDialog open mode="create" onOpenChange={vi.fn()} />)
            expect(screen.getByText("Add tool")).toBeInTheDocument()
        })

        it("starts with DEFAULT_PARAMETERS in params textarea", () => {
            renderWithQuery(<ToolFormDialog open mode="create" onOpenChange={vi.fn()} />)
            const textarea = screen.getByRole("textbox", { name: /parameters/i })
            expect((textarea as HTMLTextAreaElement).value).toBe(DEFAULT_PARAMETERS)
        })

        it("starts with empty name, description, webhook", () => {
            renderWithQuery(<ToolFormDialog open mode="create" onOpenChange={vi.fn()} />)
            expect((screen.getByRole("textbox", { name: /^name$/i }) as HTMLInputElement).value).toBe("")
            expect((screen.getByRole("textbox", { name: /description/i }) as HTMLInputElement).value).toBe("")
            expect((screen.getByRole("textbox", { name: /webhook/i }) as HTMLInputElement).value).toBe("")
        })

        it("starts with enabled switch checked", () => {
            renderWithQuery(<ToolFormDialog open mode="create" onOpenChange={vi.fn()} />)
            const sw = screen.getByRole("switch", { name: /enabled/i })
            expect(sw).toHaveAttribute("data-state", "checked")
        })

        it("shows toast.error and does NOT call mutate when name is empty", async () => {
            const { createMut } = setup()
            const user = userEvent.setup()
            renderWithQuery(<ToolFormDialog open mode="create" onOpenChange={vi.fn()} />)
            await user.click(screen.getByRole("button", { name: /save/i }))
            expect(toast.error).toHaveBeenCalledWith("Name required")
            expect(createMut.mutate).not.toHaveBeenCalled()
        })

        it("shows parse error and does NOT call mutate for invalid JSON", async () => {
            const { createMut } = setup()
            const user = userEvent.setup()
            renderWithQuery(<ToolFormDialog open mode="create" onOpenChange={vi.fn()} />)
            await user.type(screen.getByRole("textbox", { name: /^name$/i }), "my_tool")
            const params = screen.getByRole("textbox", { name: /parameters/i })
            await user.clear(params)
            await user.type(params, "not valid json")
            await user.click(screen.getByRole("button", { name: /save/i }))
            // After invalid JSON, parseError is shown alongside the existing label
            // The label "Parameters (JSON Schema)" also contains "JSON", so
            // getAllByText(/JSON/i) returns ≥2 when the error span is rendered
            expect(screen.getAllByText(/JSON/i).length).toBeGreaterThan(1)
            expect(createMut.mutate).not.toHaveBeenCalled()
        })

        it("calls createMutation.mutate with correct payload on valid submit", async () => {
            const { createMut } = setup()
            const user = userEvent.setup()
            renderWithQuery(<ToolFormDialog open mode="create" onOpenChange={vi.fn()} />)
            await user.type(screen.getByRole("textbox", { name: /^name$/i }), "get_weather")
            await user.type(screen.getByRole("textbox", { name: /description/i }), "Fetch weather")
            await user.type(screen.getByRole("textbox", { name: /webhook/i }), "https://hook.example.com")
            await user.click(screen.getByRole("button", { name: /save/i }))
            expect(createMut.mutate).toHaveBeenCalledWith({
                name: "get_weather",
                description: "Fetch weather",
                parameters: { type: "object", properties: {}, required: [] },
                webhook_url: "https://hook.example.com",
                enabled: true,
            })
        })

        it("sets webhook_url to null when left empty", async () => {
            const { createMut } = setup()
            const user = userEvent.setup()
            renderWithQuery(<ToolFormDialog open mode="create" onOpenChange={vi.fn()} />)
            await user.type(screen.getByRole("textbox", { name: /^name$/i }), "my_tool")
            await user.click(screen.getByRole("button", { name: /save/i }))
            expect(createMut.mutate).toHaveBeenCalledWith(
                expect.objectContaining({ webhook_url: null })
            )
        })

        it("toggles enabled switch", async () => {
            const { createMut } = setup()
            const user = userEvent.setup()
            renderWithQuery(<ToolFormDialog open mode="create" onOpenChange={vi.fn()} />)
            const sw = screen.getByRole("switch", { name: /enabled/i })
            await user.click(sw)
            await user.type(screen.getByRole("textbox", { name: /^name$/i }), "my_tool")
            await user.click(screen.getByRole("button", { name: /save/i }))
            expect(createMut.mutate).toHaveBeenCalledWith(
                expect.objectContaining({ enabled: false })
            )
        })

        it("Cancel button calls onOpenChange(false)", async () => {
            const onOpenChange = vi.fn()
            const user = userEvent.setup()
            renderWithQuery(<ToolFormDialog open mode="create" onOpenChange={onOpenChange} />)
            await user.click(screen.getByRole("button", { name: /cancel/i }))
            expect(onOpenChange).toHaveBeenCalledWith(false)
        })

        it("disables Save and Cancel while isPending", () => {
            vi.mocked(tools.useCreate).mockReturnValue(makeMutation({ isPending: true }) as ReturnType<typeof makeMutation>)
            vi.mocked(tools.useUpdate).mockReturnValue(makeMutation() as ReturnType<typeof makeMutation>)
            renderWithQuery(<ToolFormDialog open mode="create" onOpenChange={vi.fn()} />)
            expect(screen.getByRole("button", { name: /save/i })).toBeDisabled()
            expect(screen.getByRole("button", { name: /cancel/i })).toBeDisabled()
        })
    })

    describe("edit mode", () => {
        it("shows 'Edit' title", () => {
            renderWithQuery(<ToolFormDialog open mode="edit" tool={tool} onOpenChange={vi.fn()} />)
            expect(screen.getByText("Edit")).toBeInTheDocument()
        })

        it("pre-fills all fields from tool prop", () => {
            renderWithQuery(<ToolFormDialog open mode="edit" tool={tool} onOpenChange={vi.fn()} />)
            expect((screen.getByRole("textbox", { name: /^name$/i }) as HTMLInputElement).value).toBe("get_weather")
            expect((screen.getByRole("textbox", { name: /description/i }) as HTMLInputElement).value).toBe("Fetch current weather for a city")
            expect((screen.getByRole("textbox", { name: /webhook/i }) as HTMLInputElement).value).toBe("https://example.com/webhook")
            const params = screen.getByRole("textbox", { name: /parameters/i }) as HTMLTextAreaElement
            expect(params.value).toBe(JSON.stringify(tool.parameters, null, 2))
        })

        it("calls updateMutation.mutate with {id, data} on valid submit", async () => {
            const { updateMut } = setup()
            const user = userEvent.setup()
            renderWithQuery(<ToolFormDialog open mode="edit" tool={tool} onOpenChange={vi.fn()} />)
            await user.click(screen.getByRole("button", { name: /save/i }))
            expect(updateMut.mutate).toHaveBeenCalledWith({
                id: tool.id,
                data: expect.objectContaining({ name: tool.name }),
            })
        })

        it("does NOT call createMutation in edit mode", async () => {
            const { createMut, updateMut } = setup()
            const user = userEvent.setup()
            renderWithQuery(<ToolFormDialog open mode="edit" tool={tool} onOpenChange={vi.fn()} />)
            await user.click(screen.getByRole("button", { name: /save/i }))
            expect(createMut.mutate).not.toHaveBeenCalled()
            expect(updateMut.mutate).toHaveBeenCalled()
        })
    })

    describe("onSuccess / onError callbacks", () => {
        it("toasts 'Saved' and closes dialog on success (create)", () => {
            setup()
            const onOpenChange = vi.fn()
            renderWithQuery(<ToolFormDialog open mode="create" onOpenChange={onOpenChange} />)
            // Invoke the onSuccess callback captured by the hook
            const opts = vi.mocked(tools.useCreate).mock.calls[0]?.[0] as { onSuccess: () => void } | undefined
            opts?.onSuccess()
            expect(toast.success).toHaveBeenCalledWith("Saved")
            expect(onOpenChange).toHaveBeenCalledWith(false)
        })

        it("toasts error message on error (create)", () => {
            setup()
            renderWithQuery(<ToolFormDialog open mode="create" onOpenChange={vi.fn()} />)
            const opts = vi.mocked(tools.useCreate).mock.calls[0]?.[0] as { onError: (e: Error) => void } | undefined
            opts?.onError(new Error("Something broke"))
            expect(toast.error).toHaveBeenCalledWith("Something broke")
        })

        it("toasts 'Save failed' fallback when error message is empty (create)", () => {
            setup()
            renderWithQuery(<ToolFormDialog open mode="create" onOpenChange={vi.fn()} />)
            const opts = vi.mocked(tools.useCreate).mock.calls[0]?.[0] as { onError: (e: Error) => void } | undefined
            opts?.onError(new Error(""))
            expect(toast.error).toHaveBeenCalledWith("Save failed")
        })

        it("toasts 'Saved' and closes dialog on success (edit/update)", () => {
            setup()
            const onOpenChange = vi.fn()
            renderWithQuery(<ToolFormDialog open mode="edit" tool={tool} onOpenChange={onOpenChange} />)
            const opts = vi.mocked(tools.useUpdate).mock.calls[0]?.[0] as { onSuccess: () => void } | undefined
            opts?.onSuccess()
            expect(toast.success).toHaveBeenCalledWith("Saved")
            expect(onOpenChange).toHaveBeenCalledWith(false)
        })

        it("toasts error message on error (edit/update)", () => {
            setup()
            renderWithQuery(<ToolFormDialog open mode="edit" tool={tool} onOpenChange={vi.fn()} />)
            const opts = vi.mocked(tools.useUpdate).mock.calls[0]?.[0] as { onError: (e: Error) => void } | undefined
            opts?.onError(new Error("Update failed!"))
            expect(toast.error).toHaveBeenCalledWith("Update failed!")
        })

        it("toasts 'Save failed' fallback when update error message is empty", () => {
            setup()
            renderWithQuery(<ToolFormDialog open mode="edit" tool={tool} onOpenChange={vi.fn()} />)
            const opts = vi.mocked(tools.useUpdate).mock.calls[0]?.[0] as { onError: (e: Error) => void } | undefined
            opts?.onError(new Error(""))
            expect(toast.error).toHaveBeenCalledWith("Save failed")
        })
    })

    describe("extra branch coverage", () => {
        it("does nothing when open=false (useEffect early return)", () => {
            // Render with open=false — should still mount without errors
            const { container } = renderWithQuery(
                <ToolFormDialog open={false} mode="create" onOpenChange={vi.fn()} />
            )
            expect(container).toBeTruthy()
        })

        it("handles tool with null webhook_url and empty description", () => {
            const toolNullFields = { ...tool, description: null, webhook_url: null, parameters: null }
            renderWithQuery(<ToolFormDialog open mode="edit" tool={toolNullFields as unknown as typeof tool} onOpenChange={vi.fn()} />)
            // Should pre-fill with empty strings via ?? fallback
            expect((screen.getByRole("textbox", { name: /webhook/i }) as HTMLInputElement).value).toBe("")
            expect((screen.getByRole("textbox", { name: /description/i }) as HTMLInputElement).value).toBe("")
        })

        it("submits with empty parameters using default {} object", async () => {
            const { createMut } = setup()
            const user = userEvent.setup()
            renderWithQuery(<ToolFormDialog open mode="create" onOpenChange={vi.fn()} />)
            await user.type(screen.getByRole("textbox", { name: /^name$/i }), "my-tool")
            const paramsTA = screen.getByRole("textbox", { name: /parameters/i }) as HTMLTextAreaElement
            await user.clear(paramsTA)
            await user.click(screen.getByRole("button", { name: /save/i }))
            expect(createMut.mutate).toHaveBeenCalledWith(
                expect.objectContaining({ parameters: {} })
            )
        })

        it("does nothing in edit mode when tool is undefined (else if false branch)", async () => {
            const { createMut, updateMut } = setup()
            const user = userEvent.setup()
            // mode=edit with no tool — handleSubmit should not call either mutation
            renderWithQuery(
                <ToolFormDialog open mode="edit" tool={undefined} onOpenChange={vi.fn()} />
            )
            // Fill in a name so we get past the name check
            await user.type(screen.getByRole("textbox", { name: /^name$/i }), "my-tool")
            await user.click(screen.getByRole("button", { name: /save/i }))
            expect(createMut.mutate).not.toHaveBeenCalled()
            expect(updateMut.mutate).not.toHaveBeenCalled()
        })
    })
})
