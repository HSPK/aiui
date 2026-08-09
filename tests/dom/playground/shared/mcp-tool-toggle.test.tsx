import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { McpToolToggle } from "@/components/playground/mcp-tool-toggle"
import { usePlaygroundStore } from "@/lib/stores/playground-store"
import { resetPlaygroundStore } from "../_render"
import type { McpServerDTO } from "@/lib/schemas/mcp"

const useListMock = vi.fn()
vi.mock("@/lib/api/mcp", () => ({
    mcpServers: {
        useList: (...args: unknown[]) => useListMock(...args),
    },
}))

vi.mock("next/link", () => ({
    default: ({ href, children, ...rest }: any) => (
        <a href={href} {...rest}>
            {children}
        </a>
    ),
}))

function makeServer(overrides: Partial<McpServerDTO> = {}): McpServerDTO {
    return {
        id: "srv_1",
        name: "GitHub",
        description: "GitHub MCP server",
        transport: "stdio",
        config: {},
        enabled: true,
        last_check_status: "ok",
        last_check_at: "2024-01-01T00:00:00.000Z",
        last_check_error: null,
        tools_cache: null,
        resources_cache: null,
        prompts_cache: null,
        server_info: null,
        config_version: "v1",
        created_at: "2024-01-01T00:00:00.000Z",
        updated_at: "2024-01-01T00:00:00.000Z",
        ...overrides,
    }
}

afterEach(() => {
    cleanup()
    resetPlaygroundStore()
})

describe("McpToolToggle", () => {
    it("shows no badge count when there are no usable servers", () => {
        useListMock.mockReturnValue({ data: [] })
        render(<McpToolToggle conversationId="conv_1" />)
        expect(screen.queryByText(/^\d+$/)).not.toBeInTheDocument()
    })

    it("shows the active-count badge for globally-enabled, healthy servers", () => {
        useListMock.mockReturnValue({
            data: [makeServer({ id: "a", name: "A" }), makeServer({ id: "b", name: "B" })],
        })
        render(<McpToolToggle conversationId="conv_1" />)
        expect(screen.getByText("2")).toBeInTheDocument()
    })

    it("excludes servers that are globally disabled or unhealthy from the count and the list", async () => {
        const user = userEvent.setup()
        useListMock.mockReturnValue({
            data: [
                makeServer({ id: "a", name: "Healthy", enabled: true, last_check_status: "ok" }),
                makeServer({ id: "b", name: "Disabled", enabled: false, last_check_status: "ok" }),
                makeServer({ id: "c", name: "Unhealthy", enabled: true, last_check_status: "error" }),
                makeServer({ id: "d", name: "NeverChecked", enabled: true, last_check_status: null }),
            ],
        })
        render(<McpToolToggle conversationId="conv_1" />)
        expect(screen.getByText("1")).toBeInTheDocument()

        await user.click(screen.getByTitle("MCP tools"))
        expect(await screen.findByText("Healthy")).toBeInTheDocument()
        expect(screen.queryByText("Disabled")).not.toBeInTheDocument()
        expect(screen.queryByText("Unhealthy")).not.toBeInTheDocument()
        expect(screen.queryByText("NeverChecked")).not.toBeInTheDocument()
    })

    it("shows the empty state with a link to /mcp when no server is usable", async () => {
        const user = userEvent.setup()
        useListMock.mockReturnValue({ data: [makeServer({ enabled: false })] })
        render(<McpToolToggle conversationId="conv_1" />)
        await user.click(screen.getByTitle("MCP tools"))
        expect(await screen.findByText("No MCP servers configured.")).toBeInTheDocument()
        expect(screen.getByRole("link", { name: /add one/i })).toHaveAttribute("href", "/mcp")
    })

    it("shows server name and description rows in the popover", async () => {
        const user = userEvent.setup()
        useListMock.mockReturnValue({
            data: [makeServer({ id: "a", name: "GitHub", description: "Code search + issues" })],
        })
        render(<McpToolToggle conversationId="conv_1" />)
        await user.click(screen.getByTitle("MCP tools"))
        expect(await screen.findByText("GitHub")).toBeInTheDocument()
        expect(screen.getByText("Code search + issues")).toBeInTheDocument()
    })

    it("every available server's switch starts checked (enabled) when there is no per-conversation denylist yet", async () => {
        const user = userEvent.setup()
        useListMock.mockReturnValue({
            data: [makeServer({ id: "a", name: "A" }), makeServer({ id: "b", name: "B" })],
        })
        render(<McpToolToggle conversationId="conv_1" />)
        await user.click(screen.getByTitle("MCP tools"))
        const switches = await screen.findAllByRole("switch")
        expect(switches).toHaveLength(2)
        for (const s of switches) expect(s).toHaveAttribute("data-state", "checked")
    })

    it("turning a switch off adds the server id to the conversation's disabledMcpServerIds", async () => {
        const user = userEvent.setup()
        useListMock.mockReturnValue({
            data: [makeServer({ id: "a", name: "A" }), makeServer({ id: "b", name: "B" })],
        })
        render(<McpToolToggle conversationId="conv_1" />)
        await user.click(screen.getByTitle("MCP tools"))
        const row = (await screen.findByText("A")).closest("label")!
        await user.click(row.querySelector('[role="switch"]')!)

        expect(usePlaygroundStore.getState().settings["conv_1"].disabledMcpServerIds).toEqual(["a"])
    })

    it("turning a switch back on removes the server id from disabledMcpServerIds", async () => {
        const user = userEvent.setup()
        useListMock.mockReturnValue({
            data: [makeServer({ id: "a", name: "A" }), makeServer({ id: "b", name: "B" })],
        })
        usePlaygroundStore.getState().updateSettings("conv_1", { disabledMcpServerIds: ["a", "b"] })
        render(<McpToolToggle conversationId="conv_1" />)
        await user.click(screen.getByTitle("MCP tools"))
        const row = (await screen.findByText("A")).closest("label")!
        await user.click(row.querySelector('[role="switch"]')!)

        expect(usePlaygroundStore.getState().settings["conv_1"].disabledMcpServerIds).toEqual(["b"])
    })

    it("the badge count reflects the denylist (decreases when a server is toggled off)", async () => {
        const user = userEvent.setup()
        useListMock.mockReturnValue({
            data: [makeServer({ id: "a", name: "A" }), makeServer({ id: "b", name: "B" })],
        })
        render(<McpToolToggle conversationId="conv_1" />)
        expect(screen.getByText("2")).toBeInTheDocument()

        await user.click(screen.getByTitle("MCP tools"))
        const row = (await screen.findByText("A")).closest("label")!
        await user.click(row.querySelector('[role="switch"]')!)

        expect(screen.getByText("1")).toBeInTheDocument()
    })

    // Fixed bug: components/playground/mcp-tool-toggle.tsx trigger button
    // used to rely solely on `title="MCP tools"` for its accessible name,
    // but per the accname spec `title` is only a last-resort fallback used
    // when the element has NO text content. Once activeCount > 0, the Badge
    // renders visible text (e.g. "1"), which became the button's computed
    // accessible name instead — so a screen reader announced just "1,
    // button" rather than "MCP tools, 1, button" whenever any server was
    // active. Fixed with an explicit `aria-label="MCP tools"` alongside the
    // `title`, which the accname algorithm prefers over text content.
    it(
        "button still exposes an accessible name of 'MCP tools' when the count badge is present",
        () => {
            useListMock.mockReturnValue({ data: [makeServer({ id: "a", name: "A" })] })
            render(<McpToolToggle conversationId="conv_1" />)
            expect(screen.getByRole("button", { name: /mcp tools/i })).toBeInTheDocument()
        }
    )

    it("button also exposes an accessible name of 'MCP tools' with no active servers (no badge)", () => {
        useListMock.mockReturnValue({ data: [] })
        render(<McpToolToggle conversationId="conv_1" />)
        expect(screen.getByRole("button", { name: /mcp tools/i })).toBeInTheDocument()
    })

    it("scopes disabledMcpServerIds to the given conversationId only", async () => {
        const user = userEvent.setup()
        useListMock.mockReturnValue({ data: [makeServer({ id: "a", name: "A" })] })
        render(<McpToolToggle conversationId="conv_1" />)
        await user.click(screen.getByTitle("MCP tools"))
        const row = (await screen.findByText("A")).closest("label")!
        await user.click(row.querySelector('[role="switch"]')!)

        expect(usePlaygroundStore.getState().settings["conv_1"]?.disabledMcpServerIds).toEqual(["a"])
        expect(usePlaygroundStore.getState().settings["conv_2"]).toBeUndefined()
    })
})
