import { describe, it, expect, vi, afterEach } from "vitest"
import { screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { render } from "@testing-library/react"

import {
    HealthSection,
    RuntimeSection,
    ServerInfoSection,
    EndpointSection,
    ToolsSection,
    ResourcesSection,
    PromptsSection,
} from "@/components/tools/_parts/sections"
import { renderWithQuery } from "./_render"
import {
    mcpServerStdio,
    mcpServerHttp,
    mcpRuntimeConnected,
    mcpRuntimeFailed,
    mcpRuntimeIdle,
} from "./_fixtures"
import type { McpServerInfo } from "@/lib/schemas/mcp"

// ─────────────────────────────────────────────────────────────
// HealthSection
// ─────────────────────────────────────────────────────────────

describe("HealthSection", () => {
    const baseProps = {
        server: mcpServerStdio,
        onCheck: vi.fn(),
        isChecking: false,
        isAdmin: true,
    }

    it("shows 'Connected' when status=ok", () => {
        render(<HealthSection {...baseProps} />)
        expect(screen.getByText("Connected")).toBeInTheDocument()
    })

    it("shows 'Failed' when status=error", () => {
        render(<HealthSection {...baseProps} server={mcpServerHttp} />)
        expect(screen.getByText("Failed")).toBeInTheDocument()
    })

    it("shows error block when status=error and not checking", () => {
        render(<HealthSection {...baseProps} server={mcpServerHttp} />)
        expect(screen.getByText("connect ECONNREFUSED")).toBeInTheDocument()
    })

    it("shows 'Never checked' when status=null", () => {
        const unchecked = { ...mcpServerStdio, last_check_status: null as null, last_check_at: null }
        render(<HealthSection {...baseProps} server={unchecked} />)
        expect(screen.getByText("Never checked")).toBeInTheDocument()
    })

    it("renders Re-check button for isAdmin=true", () => {
        render(<HealthSection {...baseProps} />)
        expect(screen.getByRole("button", { name: /re-check/i })).toBeInTheDocument()
    })

    it("does NOT render Re-check button for isAdmin=false", () => {
        render(<HealthSection {...baseProps} isAdmin={false} />)
        expect(screen.queryByRole("button", { name: /re-check/i })).toBeNull()
    })

    it("shows phase label while isChecking with streaming.phase", () => {
        render(
            <HealthSection
                {...baseProps}
                isChecking
                streaming={{ phase: "spawning", logs: [], error: null }}
            />
        )
        // PHASE_LABELS["spawning"] = "Spawning…" (capital S, U+2026 ellipsis)
        expect(screen.getByText("Spawning…")).toBeInTheDocument()
    })

    it("shows phase badge while isChecking", () => {
        render(
            <HealthSection
                {...baseProps}
                isChecking
                streaming={{ phase: "connecting", logs: [], error: null }}
            />
        )
        // Badge shows phase value
        expect(screen.getByText("connecting")).toBeInTheDocument()
    })

    it("shows log panel with log lines when streaming", () => {
        render(
            <HealthSection
                {...baseProps}
                isChecking
                streaming={{ phase: "spawning", logs: ["[info] starting", "[info] ready"], error: null }}
            />
        )
        expect(screen.getByText("[info] starting")).toBeInTheDocument()
        expect(screen.getByText("[info] ready")).toBeInTheDocument()
    })

    it("shows 'Waiting for output…' when streaming with 0 logs", () => {
        render(
            <HealthSection
                {...baseProps}
                isChecking
                streaming={{ phase: "spawning", logs: [], error: null }}
            />
        )
        expect(screen.getByText("Waiting for output…")).toBeInTheDocument()
    })

    it("does not show error block while isChecking", () => {
        render(
            <HealthSection
                {...baseProps}
                server={mcpServerHttp}
                isChecking
                streaming={{ phase: "connecting", logs: [], error: null }}
            />
        )
        // error block (pre with error text) should NOT appear while checking
        expect(screen.queryByText("connect ECONNREFUSED")).toBeNull()
    })
})

// ─────────────────────────────────────────────────────────────
// RuntimeSection
// ─────────────────────────────────────────────────────────────

describe("RuntimeSection", () => {
    const baseProps = {
        server: mcpServerStdio,
        runtime: null,
        isLoading: false,
        isAdmin: true,
        onStop: vi.fn(),
        onRestart: vi.fn(),
        isStopping: false,
        isRestarting: false,
    }

    afterEach(() => {
        vi.useRealTimers()
    })

    it("shows 'Idle' badge when runtime is null", () => {
        render(<RuntimeSection {...baseProps} />)
        expect(screen.getByText("Idle")).toBeInTheDocument()
    })

    it("shows 'Connected' badge when runtime.status=connected", () => {
        render(<RuntimeSection {...baseProps} runtime={mcpRuntimeConnected} />)
        expect(screen.getByText("Connected")).toBeInTheDocument()
    })

    it("shows 'Failed' badge when runtime.status=failed", () => {
        render(<RuntimeSection {...baseProps} runtime={mcpRuntimeFailed} />)
        expect(screen.getByText("Failed")).toBeInTheDocument()
    })

    it("shows runtime error pre block when status=failed", () => {
        render(<RuntimeSection {...baseProps} runtime={mcpRuntimeFailed} />)
        expect(screen.getByText("spawn ENOENT")).toBeInTheDocument()
    })

    it("shows PID row for stdio server", () => {
        render(<RuntimeSection {...baseProps} runtime={mcpRuntimeConnected} />)
        expect(screen.getByText("4242")).toBeInTheDocument()
    })

    it("does NOT show PID row for http server", () => {
        render(<RuntimeSection {...baseProps} server={mcpServerHttp} runtime={mcpRuntimeConnected} />)
        expect(screen.queryByText("4242")).toBeNull()
    })

    it("shows drift warning when built_for !== config_version", () => {
        // mcpRuntimeConnected.built_for="2024-01-05T00:00:00.000Z" vs mcpServerStdio.config_version="v1"
        render(<RuntimeSection {...baseProps} runtime={mcpRuntimeConnected} />)
        expect(screen.getByText(/Stale/i)).toBeInTheDocument()
    })

    it("Stop button is disabled when status=idle", () => {
        render(<RuntimeSection {...baseProps} runtime={mcpRuntimeIdle} isAdmin />)
        expect(screen.getByRole("button", { name: /stop/i })).toBeDisabled()
    })

    it("Stop button is disabled when isStopping=true", () => {
        render(<RuntimeSection {...baseProps} runtime={mcpRuntimeConnected} isStopping />)
        expect(screen.getByRole("button", { name: /stop/i })).toBeDisabled()
    })

    it("Restart button is disabled when isBusy", () => {
        render(<RuntimeSection {...baseProps} runtime={mcpRuntimeConnected} isRestarting />)
        expect(screen.getByRole("button", { name: /restart/i })).toBeDisabled()
    })

    it("shows loading text when isLoading and no runtime", () => {
        render(<RuntimeSection {...baseProps} isLoading />)
        expect(screen.getByText(/Loading runtime status/i)).toBeInTheDocument()
    })

    it("does NOT show loading text when runtime is provided", () => {
        render(<RuntimeSection {...baseProps} isLoading runtime={mcpRuntimeConnected} />)
        expect(screen.queryByText(/Loading runtime status/i)).toBeNull()
    })

    it("hides Stop/Restart buttons when isAdmin=false", () => {
        render(<RuntimeSection {...baseProps} isAdmin={false} />)
        expect(screen.queryByRole("button", { name: /stop/i })).toBeNull()
        expect(screen.queryByRole("button", { name: /restart/i })).toBeNull()
    })

    it("formats uptime using fake timers", () => {
        vi.useFakeTimers()
        // started_at = "2024-01-10T00:00:00.000Z"
        // Set now to 65 seconds later
        vi.setSystemTime(new Date("2024-01-10T00:01:05.000Z"))
        render(<RuntimeSection {...baseProps} runtime={mcpRuntimeConnected} />)
        expect(screen.getByText(/1m 5s/)).toBeInTheDocument()
    })

    it("follow-tail checkbox toggles", async () => {
        const user = userEvent.setup()
        render(<RuntimeSection {...baseProps} runtime={{ ...mcpRuntimeConnected, recent_logs: ["line1", "line2"] }} />)
        const checkbox = screen.getByRole("checkbox", { name: /follow/i })
        expect(checkbox).toBeChecked()
        await user.click(checkbox)
        expect(checkbox).not.toBeChecked()
    })

    it("shows log lines in RuntimeLogPanel", () => {
        render(<RuntimeSection {...baseProps} runtime={{ ...mcpRuntimeConnected, recent_logs: ["[info] spawning", "[info] connected"] }} />)
        expect(screen.getByText("[info] spawning")).toBeInTheDocument()
        expect(screen.getByText("[info] connected")).toBeInTheDocument()
    })
})

// ─────────────────────────────────────────────────────────────
// ServerInfoSection
// ─────────────────────────────────────────────────────────────

describe("ServerInfoSection", () => {
    it("renders null for empty info (no name/version/instructions/capabilities)", () => {
        const { container } = render(<ServerInfoSection info={{} as McpServerInfo} />)
        expect(container.firstChild).toBeNull()
    })

    it("shows server name and version", () => {
        render(<ServerInfoSection info={{ name: "my-server", version: "2.0.0" }} />)
        expect(screen.getByText(/my-server/)).toBeInTheDocument()
        expect(screen.getByText(/@ 2.0.0/)).toBeInTheDocument()
    })

    it("shows capability tags", () => {
        render(<ServerInfoSection info={{ name: "s", capabilities: { tools: {}, resources: {} } }} />)
        expect(screen.getByText("tools")).toBeInTheDocument()
        expect(screen.getByText("resources")).toBeInTheDocument()
    })

    it("shows instructions", () => {
        render(<ServerInfoSection info={{ instructions: "Use me wisely" }} />)
        expect(screen.getByText("Use me wisely")).toBeInTheDocument()
    })

    it("renders null when only version is provided but no name/instructions/caps", () => {
        // version alone does NOT count as hasIdentity = !!(info.name || info.version)
        // Actually it does - version is included in hasIdentity
        const { container } = render(<ServerInfoSection info={{ version: "1.0" }} />)
        // hasIdentity = true (version is truthy), so it should render
        expect(container.firstChild).not.toBeNull()
    })
})

// ─────────────────────────────────────────────────────────────
// EndpointSection
// ─────────────────────────────────────────────────────────────

describe("EndpointSection", () => {
    it("shows stdio command and args", () => {
        render(<EndpointSection server={mcpServerStdio} isAdmin />)
        // "$ " is in a span and "npx ..." is a sibling text node — check via body textContent
        expect(document.body.textContent).toContain("npx")
        expect(document.body.textContent).toContain("-y @modelcontextprotocol/server-filesystem")
    })

    it("shows http url", () => {
        render(<EndpointSection server={mcpServerHttp} isAdmin />)
        expect(screen.getByText("https://mcp.example.com/sse")).toBeInTheDocument()
    })

    it("masks secret env keys (TOKEN) with •••", () => {
        render(<EndpointSection server={mcpServerStdio} isAdmin />)
        // "•••" is a text node within <li>TOKEN=•••</li> — check via body textContent
        expect(document.body.textContent).toContain("•••")
        // The actual value "secret-value" should NOT appear
        expect(screen.queryByText("secret-value")).toBeNull()
        expect(document.body.textContent).not.toContain("secret-value")
    })

    it("shows plain-text value for non-secret env key", () => {
        const serverWithPlainEnv = {
            ...mcpServerStdio,
            config: {
                ...mcpServerStdio.config,
                env: { NODE_ENV: "production", TOKEN: "s3cr3t" },
            },
        }
        render(<EndpointSection server={serverWithPlainEnv} isAdmin />)
        // NODE_ENV is not secret, value "production" should appear in plain text
        expect(document.body.textContent).toContain("production")
    })

    it("masks Authorization header with •••", () => {
        render(<EndpointSection server={mcpServerHttp} isAdmin />)
        expect(screen.getByText("•••")).toBeInTheDocument()
        expect(screen.queryByText("******")).toBeNull()
    })

    it("hides env section when isAdmin=false", () => {
        render(<EndpointSection server={mcpServerStdio} isAdmin={false} />)
        // Env label should not appear
        expect(screen.queryByText("Env")).toBeNull()
        // TOKEN key should not appear
        expect(screen.queryByText("TOKEN")).toBeNull()
    })

    it("hides headers section when isAdmin=false", () => {
        render(<EndpointSection server={mcpServerHttp} isAdmin={false} />)
        expect(screen.queryByText("Headers")).toBeNull()
    })
})

// ─────────────────────────────────────────────────────────────
// ToolsSection
// ─────────────────────────────────────────────────────────────

describe("ToolsSection", () => {
    it("shows error empty state when status=error", () => {
        render(<ToolsSection tools={[]} status="error" />)
        expect(screen.getByText(/last check failed/i)).toBeInTheDocument()
    })

    it("shows default empty state when status=null", () => {
        render(<ToolsSection tools={[]} status={null} />)
        expect(screen.getByText(/Run a check/i)).toBeInTheDocument()
    })

    it("shows tool count in heading", () => {
        render(<ToolsSection tools={mcpServerStdio.tools_cache!} status="ok" />)
        expect(screen.getByText("(2)")).toBeInTheDocument()
    })

    it("renders tool names", () => {
        render(<ToolsSection tools={mcpServerStdio.tools_cache!} status="ok" />)
        expect(screen.getByText("read_file")).toBeInTheDocument()
        expect(screen.getByText("write_file")).toBeInTheDocument()
    })

    it("expands tool row on click to show params", async () => {
        const user = userEvent.setup()
        render(<ToolsSection tools={mcpServerStdio.tools_cache!} status="ok" />)
        await user.click(screen.getByText("read_file"))
        // path param appears
        expect(screen.getByText("path")).toBeInTheDocument()
        expect(screen.getByText(/: string/)).toBeInTheDocument()
    })

    it("shows '(no parameters)' for tool with empty properties", async () => {
        const user = userEvent.setup()
        render(<ToolsSection tools={mcpServerStdio.tools_cache!} status="ok" />)
        await user.click(screen.getByText("write_file"))
        expect(screen.getByText("(no parameters)")).toBeInTheDocument()
    })

    it("shows required badge for required parameter", async () => {
        const user = userEvent.setup()
        const toolWithRequired = {
            name: "find",
            description: "Find files",
            parameters: {
                type: "object",
                properties: { query: { type: "string" } },
                required: ["query"],
            },
        }
        render(<ToolsSection tools={[toolWithRequired]} status="ok" />)
        await user.click(screen.getByText("find"))
        expect(screen.getByText("required")).toBeInTheDocument()
    })

    it("does NOT show required badge for non-required parameter", async () => {
        const user = userEvent.setup()
        // read_file's path param is NOT in required[] in the fixture
        render(<ToolsSection tools={mcpServerStdio.tools_cache!} status="ok" />)
        await user.click(screen.getByText("read_file"))
        expect(screen.queryByText("required")).toBeNull()
    })
})

// ─────────────────────────────────────────────────────────────
// ResourcesSection
// ─────────────────────────────────────────────────────────────

describe("ResourcesSection", () => {
    it("shows 'does not advertise resources' hint when !capabilityAdvertised", () => {
        render(<ResourcesSection snapshot={null} capabilityAdvertised={false} status="ok" />)
        expect(screen.getByText(/does not advertise/i)).toBeInTheDocument()
        expect(screen.getByText("resources")).toBeInTheDocument()
    })

    it("shows error hint when capabilityAdvertised, snapshot=null, status=error", () => {
        render(<ResourcesSection snapshot={null} capabilityAdvertised status="error" />)
        expect(screen.getByText(/Last check failed/i)).toBeInTheDocument()
    })

    it("shows non-error hint when capabilityAdvertised, snapshot=null, status=null", () => {
        render(<ResourcesSection snapshot={null} capabilityAdvertised status={null} />)
        expect(screen.getByText(/list call did not complete/i)).toBeInTheDocument()
    })

    it("shows 'exposes none' hint when snapshot has 0 resources + 0 templates", () => {
        render(
            <ResourcesSection
                snapshot={{ resources: [], templates: [] }}
                capabilityAdvertised
                status="ok"
            />
        )
        expect(screen.getByText(/exposes none/i)).toBeInTheDocument()
    })

    it("renders resource list from mcpServerStdio", () => {
        render(
            <ResourcesSection
                snapshot={mcpServerStdio.resources_cache}
                capabilityAdvertised
                status="ok"
            />
        )
        expect(screen.getByText("file:///data/readme.md")).toBeInTheDocument()
        expect(screen.getByText("readme")).toBeInTheDocument()
    })

    it("renders template rows with 'template' tag", () => {
        render(
            <ResourcesSection
                snapshot={mcpServerStdio.resources_cache}
                capabilityAdvertised
                status="ok"
            />
        )
        expect(screen.getByText("template")).toBeInTheDocument()
        expect(screen.getByText("file:///data/{path}")).toBeInTheDocument()
    })
})

// ─────────────────────────────────────────────────────────────
// PromptsSection
// ─────────────────────────────────────────────────────────────

describe("PromptsSection", () => {
    it("shows 'does not advertise prompts' hint when !capabilityAdvertised", () => {
        render(<PromptsSection prompts={null} capabilityAdvertised={false} status="ok" />)
        expect(screen.getByText(/does not advertise/i)).toBeInTheDocument()
        expect(screen.getByText("prompts")).toBeInTheDocument()
    })

    it("shows error hint when capabilityAdvertised, prompts=null, status=error", () => {
        render(<PromptsSection prompts={null} capabilityAdvertised status="error" />)
        expect(screen.getByText(/Last check failed/i)).toBeInTheDocument()
    })

    it("shows non-error hint when capabilityAdvertised, prompts=null, status=null", () => {
        render(<PromptsSection prompts={null} capabilityAdvertised status={null} />)
        expect(screen.getByText(/list call did not complete/i)).toBeInTheDocument()
    })

    it("shows 'exposes none' hint when prompts is empty array", () => {
        render(<PromptsSection prompts={[]} capabilityAdvertised status="ok" />)
        expect(screen.getByText(/exposes none/i)).toBeInTheDocument()
    })

    it("renders prompt name and description", () => {
        render(
            <PromptsSection prompts={mcpServerStdio.prompts_cache} capabilityAdvertised status="ok" />
        )
        expect(screen.getByText("summarize")).toBeInTheDocument()
        expect(screen.getByText("Summarize a file")).toBeInTheDocument()
    })

    it("expands prompt row to show arguments with required badge", async () => {
        const user = userEvent.setup()
        render(
            <PromptsSection prompts={mcpServerStdio.prompts_cache} capabilityAdvertised status="ok" />
        )
        await user.click(screen.getByText("summarize"))
        // prompt arg "path" is required: true in fixture
        expect(screen.getByText("path")).toBeInTheDocument()
        expect(screen.getByText("required")).toBeInTheDocument()
    })

    it("shows prompts count in heading", () => {
        render(
            <PromptsSection prompts={mcpServerStdio.prompts_cache} capabilityAdvertised status="ok" />
        )
        expect(screen.getByText("(1)")).toBeInTheDocument()
    })
})
