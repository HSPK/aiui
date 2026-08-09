import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { ToolsTable } from "@/components/tools/tools-table"
import { tool, toolDisabled } from "./_fixtures"

describe("ToolsTable", () => {
    describe("empty state", () => {
        it("shows empty state icon when tools is empty", () => {
            // DataTableEmpty ignores its children prop and renders an Inbox SVG with aria-label="empty"
            render(<ToolsTable tools={[]} />)
            expect(screen.getByLabelText("empty")).toBeInTheDocument()
        })
    })

    describe("data columns", () => {
        it("renders name, description, webhook and enabled badge", () => {
            render(<ToolsTable tools={[tool]} />)
            expect(screen.getByText("get_weather")).toBeInTheDocument()
            expect(screen.getByText("Fetch current weather for a city")).toBeInTheDocument()
            expect(screen.getByText("https://example.com/webhook")).toBeInTheDocument()
            expect(screen.getByText("on")).toBeInTheDocument()
        })

        it("shows italic 'none' fallback when webhook_url is null", () => {
            render(<ToolsTable tools={[toolDisabled]} />)
            expect(screen.getByText("none")).toBeInTheDocument()
        })

        it("shows '—' fallback when description is empty string", () => {
            render(<ToolsTable tools={[toolDisabled]} />)
            expect(screen.getByText("—")).toBeInTheDocument()
        })

        it("shows 'off' badge for disabled tool", () => {
            render(<ToolsTable tools={[toolDisabled]} />)
            expect(screen.getByText("off")).toBeInTheDocument()
        })

        it("renders multiple tools", () => {
            render(<ToolsTable tools={[tool, toolDisabled]} />)
            expect(screen.getByText("get_weather")).toBeInTheDocument()
            expect(screen.getByText("disabled_tool")).toBeInTheDocument()
        })
    })

    describe("actions column", () => {
        it("hides Edit and Delete when neither callback is provided", () => {
            render(<ToolsTable tools={[tool]} />)
            expect(screen.queryByTitle("Edit")).toBeNull()
            expect(screen.queryByTitle("Delete")).toBeNull()
        })

        it("shows only Edit button when only onEdit provided", () => {
            render(<ToolsTable tools={[tool]} onEdit={vi.fn()} />)
            expect(screen.getByTitle("Edit")).toBeInTheDocument()
            expect(screen.queryByTitle("Delete")).toBeNull()
        })

        it("shows only Delete button when only onDelete provided", () => {
            render(<ToolsTable tools={[tool]} onDelete={vi.fn()} />)
            expect(screen.queryByTitle("Edit")).toBeNull()
            expect(screen.getByTitle("Delete")).toBeInTheDocument()
        })

        it("calls onEdit with the correct tool object", async () => {
            const onEdit = vi.fn()
            const user = userEvent.setup()
            render(<ToolsTable tools={[tool]} onEdit={onEdit} />)
            await user.click(screen.getByTitle("Edit"))
            expect(onEdit).toHaveBeenCalledWith(tool)
        })

        it("calls onDelete with the correct tool object", async () => {
            const onDelete = vi.fn()
            const user = userEvent.setup()
            render(<ToolsTable tools={[tool]} onDelete={onDelete} />)
            await user.click(screen.getByTitle("Delete"))
            expect(onDelete).toHaveBeenCalledWith(tool)
        })

        it("renders both Edit and Delete when both callbacks provided", () => {
            render(<ToolsTable tools={[tool]} onEdit={vi.fn()} onDelete={vi.fn()} />)
            expect(screen.getByTitle("Edit")).toBeInTheDocument()
            expect(screen.getByTitle("Delete")).toBeInTheDocument()
        })
    })
})
