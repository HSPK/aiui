import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";

import { renderWithClient, queryResult, mutationResult, adminUser, normalUser } from "./_helpers";
import type { McpPreset, McpServerDTO } from "@/lib/schemas/mcp";

const useAuthMock = vi.fn();
vi.mock("@/context/auth-context", () => ({
    useAuth: () => useAuthMock(),
}));

const useSearchParamsMock = vi.fn();
const useRouterMock = vi.fn();
vi.mock("next/navigation", () => ({
    useSearchParams: () => useSearchParamsMock(),
    useRouter: () => useRouterMock(),
}));

vi.mock("sonner", () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const useListMock = vi.fn();
const usePresetsMock = vi.fn();
const useDeleteMock = vi.fn();
const checkMock = vi.fn();
vi.mock("@/lib/api/mcp", () => ({
    mcpServers: {
        useList: (q: unknown, opts: unknown) => useListMock(q, opts),
        usePresets: () => usePresetsMock(),
        useDelete: (opts: unknown) => useDeleteMock(opts),
        check: (id: string) => checkMock(id),
    },
}));

vi.mock("@/components/tools/mcp-form-dialog", () => ({
    McpFormDialog: (props: {
        open: boolean;
        mode: string;
        onOpenChange: (open: boolean) => void;
        onSaved?: (s: McpServerDTO) => void;
        preset?: McpPreset;
    }) => (
        <div data-testid="mcp-form-dialog" data-open={props.open} data-mode={props.mode}>
            {props.open && props.onSaved && (
                <button onClick={() => props.onSaved!({ id: "new-1" } as McpServerDTO)}>save-preset</button>
            )}
            {props.open && <button onClick={() => props.onOpenChange(false)}>close-form</button>}
        </div>
    ),
}));
vi.mock("@/components/tools/mcp-table", () => ({
    McpServersTable: (props: {
        servers: McpServerDTO[];
        onSelect: (s: McpServerDTO) => void;
        onEdit?: (s: McpServerDTO) => void;
        onDelete?: (s: McpServerDTO) => void;
    }) => (
        <div data-testid="mcp-table">
            {props.servers.map((s) => (
                <div key={s.id}>
                    <span>{s.name}</span>
                    <button onClick={() => props.onSelect(s)}>select-{s.id}</button>
                    {props.onEdit && <button onClick={() => props.onEdit!(s)}>edit-{s.id}</button>}
                    {props.onDelete && <button onClick={() => props.onDelete!(s)}>delete-{s.id}</button>}
                </div>
            ))}
        </div>
    ),
}));
vi.mock("@/components/tools/mcp-details-sheet", () => ({
    McpServerDetailsSheet: (props: { server: McpServerDTO | null; open: boolean; isAdmin: boolean; onOpenChange: (open: boolean) => void }) => (
        <div data-testid="mcp-details-sheet" data-open={props.open} data-server-id={props.server?.id ?? ""} data-admin={props.isAdmin}>
            {props.open && <button onClick={() => props.onOpenChange(false)}>close-sheet</button>}
        </div>
    ),
}));

import McpPage from "@/app/(dashboard)/mcp/page";
import McpPresetsPage from "@/app/(dashboard)/mcp/presets/page";

function server(overrides: Partial<McpServerDTO> = {}): McpServerDTO {
    return {
        id: "srv-1",
        name: "github",
        description: "GitHub MCP",
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
    };
}

describe("McpPage", () => {
    beforeEach(() => {
        useListMock.mockReset().mockReturnValue(queryResult<McpServerDTO[]>({ data: [server()], isLoading: false }));
        useDeleteMock.mockReset().mockReturnValue(mutationResult<McpServerDTO>());
        useSearchParamsMock.mockReset().mockReturnValue(new URLSearchParams());
        checkMock.mockReset().mockResolvedValue(server({ last_check_status: "ok" }));
        vi.mocked(toast.success).mockClear();
        vi.mocked(toast.error).mockClear();
        vi.mocked(toast.info).mockClear();
    });

    it("hides the add-server button and edit/delete handlers for a non-admin", () => {
        useAuthMock.mockReturnValue({ user: normalUser });
        renderWithClient(<McpPage />);
        expect(screen.queryByTitle("Add MCP server")).not.toBeInTheDocument();
        expect(screen.queryByText("edit-srv-1")).not.toBeInTheDocument();
        expect(screen.queryByText("delete-srv-1")).not.toBeInTheDocument();
    });

    it("shows the add-server button for an admin and opens the create dialog", async () => {
        const user = userEvent.setup();
        useAuthMock.mockReturnValue({ user: adminUser });
        renderWithClient(<McpPage />);
        expect(screen.getByText("edit-srv-1")).toBeInTheDocument();
        await user.click(screen.getByTitle("Add MCP server"));
        expect(screen.getByTestId("mcp-form-dialog")).toHaveAttribute("data-mode", "create");
        expect(screen.getByTestId("mcp-form-dialog")).toHaveAttribute("data-open", "true");
    });

    it("shows the loading overlay while loadingMcp is true", () => {
        useAuthMock.mockReturnValue({ user: adminUser });
        useListMock.mockReturnValue(queryResult<McpServerDTO[]>({ data: undefined, isLoading: true }));
        renderWithClient(<McpPage />);
        expect(screen.getByText(/loading mcp servers/i)).toBeInTheDocument();
    });

    it("only fetches the mcp list while the mcp tab is active", async () => {
        const user = userEvent.setup();
        useAuthMock.mockReturnValue({ user: adminUser });
        renderWithClient(<McpPage />);
        expect(useListMock.mock.calls.at(-1)?.[1]).toMatchObject({ enabled: true });

        await user.click(screen.getByRole("tab", { name: "Skills" }));
        expect(useListMock.mock.calls.at(-1)?.[1]).toMatchObject({ enabled: false });
        expect(screen.getByRole("heading", { name: "Skills" })).toBeInTheDocument();
        expect(screen.getByText("Coming soon.")).toBeInTheDocument();
    });

    it("opens the details sheet from ?selected= on mount", () => {
        useAuthMock.mockReturnValue({ user: adminUser });
        useSearchParamsMock.mockReturnValue(new URLSearchParams("selected=srv-1"));
        renderWithClient(<McpPage />);
        const sheet = screen.getByTestId("mcp-details-sheet");
        expect(sheet).toHaveAttribute("data-open", "true");
        expect(sheet).toHaveAttribute("data-server-id", "srv-1");
    });

    it("opens the details sheet by clicking a row", async () => {
        const user = userEvent.setup();
        useAuthMock.mockReturnValue({ user: adminUser });
        renderWithClient(<McpPage />);
        await user.click(screen.getByText("select-srv-1"));
        expect(screen.getByTestId("mcp-details-sheet")).toHaveAttribute("data-open", "true");
    });

    it("deletes via the confirm dialog", async () => {
        const user = userEvent.setup();
        useAuthMock.mockReturnValue({ user: adminUser });
        const mutate = vi.fn();
        useDeleteMock.mockReturnValue(mutationResult<McpServerDTO>({ mutate }));
        renderWithClient(<McpPage />);

        await user.click(screen.getByText("delete-srv-1"));
        expect(screen.getByText("Delete MCP server?")).toBeInTheDocument();
        expect(screen.getByText("github", { selector: "b" })).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Delete" }));
        expect(mutate).toHaveBeenCalledWith("srv-1");
    });

    it("checks every enabled server sequentially via 'Check all' and reports success", async () => {
        const user = userEvent.setup();
        useAuthMock.mockReturnValue({ user: adminUser });
        useListMock.mockReturnValue(
            queryResult<McpServerDTO[]>({
                data: [server({ id: "a", enabled: true }), server({ id: "b", enabled: false }), server({ id: "c", enabled: true })],
                isLoading: false,
            }),
        );
        renderWithClient(<McpPage />);
        await user.click(screen.getByRole("button", { name: /check all/i }));
        expect(checkMock).toHaveBeenCalledTimes(2);
        expect(checkMock).toHaveBeenCalledWith("a");
        expect(checkMock).toHaveBeenCalledWith("c");
        expect(toast.success).toHaveBeenCalled();
    });

    it("reports a mix of failures from 'Check all'", async () => {
        const user = userEvent.setup();
        useAuthMock.mockReturnValue({ user: adminUser });
        useListMock.mockReturnValue(
            queryResult<McpServerDTO[]>({ data: [server({ id: "a" }), server({ id: "b" })], isLoading: false }),
        );
        checkMock.mockResolvedValueOnce(server({ last_check_status: "ok" }));
        checkMock.mockRejectedValueOnce(new Error("boom"));
        renderWithClient(<McpPage />);
        await user.click(screen.getByRole("button", { name: /check all/i }));
        expect(toast.error).toHaveBeenCalled();
    });

    it("shows an info toast and skips the sweep when there are no enabled servers", async () => {
        const user = userEvent.setup();
        useAuthMock.mockReturnValue({ user: adminUser });
        useListMock.mockReturnValue(queryResult<McpServerDTO[]>({ data: [server({ enabled: false })], isLoading: false }));
        renderWithClient(<McpPage />);
        await user.click(screen.getByRole("button", { name: /check all/i }));
        expect(checkMock).not.toHaveBeenCalled();
        expect(toast.info).toHaveBeenCalled();
    });

    it("counts a resolved-but-not-ok check result as a failure (no exception thrown)", async () => {
        const user = userEvent.setup();
        useAuthMock.mockReturnValue({ user: adminUser });
        useListMock.mockReturnValue(queryResult<McpServerDTO[]>({ data: [server({ id: "a" })], isLoading: false }));
        checkMock.mockResolvedValueOnce(server({ last_check_status: "error" }));
        renderWithClient(<McpPage />);
        await user.click(screen.getByRole("button", { name: /check all/i }));
        expect(toast.error).toHaveBeenCalledWith("Checked 1 servers — 1 failed.");
    });

    it("computes the refetchInterval poll cadence from the cached list (polls while a check is pending, stops otherwise)", () => {
        useAuthMock.mockReturnValue({ user: adminUser });
        renderWithClient(<McpPage />);
        const refetchInterval = useListMock.mock.calls.at(-1)?.[1]?.refetchInterval as
            | ((q: { state: { data?: McpServerDTO[] } }) => number | false)
            | undefined;
        expect(refetchInterval).toBeTypeOf("function");
        expect(refetchInterval!({ state: { data: undefined } })).toBe(false);
        expect(refetchInterval!({ state: { data: [server({ last_check_status: "ok" })] } })).toBe(false);
        expect(refetchInterval!({ state: { data: [server({ last_check_status: null })] } })).toBe(2_000);
    });

    it("opens the edit dialog pre-filled with the clicked server", async () => {
        const user = userEvent.setup();
        useAuthMock.mockReturnValue({ user: adminUser });
        renderWithClient(<McpPage />);
        await user.click(screen.getByText("edit-srv-1"));
        expect(screen.getByTestId("mcp-form-dialog")).toHaveAttribute("data-mode", "edit");
        expect(screen.getByTestId("mcp-form-dialog")).toHaveAttribute("data-open", "true");
    });

    it("closes the create/edit form dialog via its onOpenChange", async () => {
        const user = userEvent.setup();
        useAuthMock.mockReturnValue({ user: adminUser });
        renderWithClient(<McpPage />);
        await user.click(screen.getByTitle("Add MCP server"));
        expect(screen.getByTestId("mcp-form-dialog")).toHaveAttribute("data-open", "true");
        await user.click(screen.getByText("close-form"));
        expect(screen.getByTestId("mcp-form-dialog")).toHaveAttribute("data-open", "false");
    });

    it("closes the details sheet via its onOpenChange, clearing the selection", async () => {
        const user = userEvent.setup();
        useAuthMock.mockReturnValue({ user: adminUser });
        renderWithClient(<McpPage />);
        await user.click(screen.getByText("select-srv-1"));
        expect(screen.getByTestId("mcp-details-sheet")).toHaveAttribute("data-open", "true");
        await user.click(screen.getByText("close-sheet"));
        expect(screen.getByTestId("mcp-details-sheet")).toHaveAttribute("data-open", "false");
    });

    it("cancelling the delete confirm dialog closes it without deleting", async () => {
        const user = userEvent.setup();
        useAuthMock.mockReturnValue({ user: adminUser });
        const mutate = vi.fn();
        useDeleteMock.mockReturnValue(mutationResult<McpServerDTO>({ mutate }));
        renderWithClient(<McpPage />);

        await user.click(screen.getByText("delete-srv-1"));
        expect(screen.getByRole("alertdialog")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Cancel" }));
        expect(mutate).not.toHaveBeenCalled();
        expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });

    it("runs the delete mutation's onSuccess/onError callbacks and reacts to selection state", () => {
        useAuthMock.mockReturnValue({ user: adminUser });
        useSearchParamsMock.mockReturnValue(new URLSearchParams("selected=srv-1"));
        let onSuccess: (() => void) | undefined;
        let onError: ((e: Error) => void) | undefined;
        useDeleteMock.mockImplementation((opts: { onSuccess?: () => void; onError?: (e: Error) => void }) => {
            onSuccess = opts.onSuccess;
            onError = opts.onError;
            return mutationResult<McpServerDTO>({});
        });
        renderWithClient(<McpPage />);
        // The selected server (srv-1, from ?selected=) is also the one
        // being deleted below — a real click on delete-srv-1 sets
        // `deleteServer` to that same row, so onSuccess's
        // `selectedId === deleteServer?.id` guard should clear the
        // selection too.
        fireEvent.click(screen.getByText("delete-srv-1"));

        act(() => {
            onSuccess?.();
        });
        expect(toast.success).toHaveBeenCalledWith("Server deleted");
        expect(screen.getByTestId("mcp-details-sheet")).toHaveAttribute("data-open", "false");

        onError?.(new Error("network down"));
        expect(toast.error).toHaveBeenCalledWith("network down");
    });

    it("leaves the selection untouched when the deleted server differs from the selected one", () => {
        useAuthMock.mockReturnValue({ user: adminUser });
        useSearchParamsMock.mockReturnValue(new URLSearchParams("selected=srv-1"));
        useListMock.mockReturnValue(
            queryResult<McpServerDTO[]>({ data: [server({ id: "srv-1" }), server({ id: "srv-2", name: "other" })], isLoading: false }),
        );
        let onSuccess: (() => void) | undefined;
        useDeleteMock.mockImplementation((opts: { onSuccess?: () => void }) => {
            onSuccess = opts.onSuccess;
            return mutationResult<McpServerDTO>({});
        });
        renderWithClient(<McpPage />);

        fireEvent.click(screen.getByText("delete-srv-2"));
        act(() => {
            onSuccess?.();
        });
        expect(toast.success).toHaveBeenCalledWith("Server deleted");
        // Selection (srv-1) is unrelated to the deleted row (srv-2), so
        // the details sheet must remain open on srv-1.
        const sheet = screen.getByTestId("mcp-details-sheet");
        expect(sheet).toHaveAttribute("data-open", "true");
        expect(sheet).toHaveAttribute("data-server-id", "srv-1");
    });

    it("falls back to a generic message when the delete error has no message", () => {
        useAuthMock.mockReturnValue({ user: adminUser });
        let onError: ((e: Error) => void) | undefined;
        useDeleteMock.mockImplementation((opts: { onError?: (e: Error) => void }) => {
            onError = opts.onError
            return mutationResult<McpServerDTO>({});
        });
        renderWithClient(<McpPage />);
        onError?.(new Error(""));
        expect(toast.error).toHaveBeenCalledWith("Delete failed");
    });

    it("reports exactly one healthy server with singular grammar", async () => {
        const user = userEvent.setup();
        useAuthMock.mockReturnValue({ user: adminUser });
        useListMock.mockReturnValue(queryResult<McpServerDTO[]>({ data: [server({ id: "solo", enabled: true })], isLoading: false }));
        checkMock.mockResolvedValueOnce(server({ last_check_status: "ok" }));
        renderWithClient(<McpPage />);
        await user.click(screen.getByRole("button", { name: /check all/i }));
        expect(toast.success).toHaveBeenCalledWith("Checked 1 server — all healthy.");
    });
});

describe("McpPresetsPage", () => {
    const presets: McpPreset[] = [
        { id: "gh", name: "github", description: "GitHub tools", transport: "stdio", config: {}, slots: [], category: "official" },
        { id: "fs", name: "filesystem", description: "Filesystem access", transport: "stdio", config: {}, slots: [{ path: "env.ROOT", label: "Root", kind: "path" }], category: "system" },
    ];

    beforeEach(() => {
        usePresetsMock.mockReset().mockReturnValue(queryResult<McpPreset[]>({ data: presets, isLoading: false }));
        useListMock.mockReset().mockReturnValue(queryResult<McpServerDTO[]>({ data: [server({ name: "github" })], isLoading: false }));
        useRouterMock.mockReset().mockReturnValue({ push: vi.fn() });
    });

    it("shows a loading state while presets load", () => {
        useAuthMock.mockReturnValue({ user: adminUser });
        usePresetsMock.mockReturnValue(queryResult<McpPreset[]>({ data: undefined, isLoading: true }));
        renderWithClient(<McpPresetsPage />);
        expect(screen.getByText(/loading catalogue/i)).toBeInTheDocument();
    });

    it("renders presets grouped by category and marks installed ones", () => {
        useAuthMock.mockReturnValue({ user: adminUser });
        renderWithClient(<McpPresetsPage />);
        expect(screen.getByText("github")).toBeInTheDocument();
        expect(screen.getByText("filesystem")).toBeInTheDocument();
        expect(screen.getByText("already installed")).toBeInTheDocument();
        expect(screen.getByText("Add another")).toBeInTheDocument();
        expect(screen.getByText("Use preset")).toBeInTheDocument();
    });

    it("filters by search query", async () => {
        const user = userEvent.setup();
        useAuthMock.mockReturnValue({ user: adminUser });
        renderWithClient(<McpPresetsPage />);
        await user.type(screen.getByPlaceholderText("Search…"), "filesystem");
        expect(screen.queryByText("github")).not.toBeInTheDocument();
        expect(screen.getByText("filesystem")).toBeInTheDocument();
    });

    it("shows 'No presets match' for an empty search result", async () => {
        const user = userEvent.setup();
        useAuthMock.mockReturnValue({ user: adminUser });
        renderWithClient(<McpPresetsPage />);
        await user.type(screen.getByPlaceholderText("Search…"), "zzz-nomatch");
        expect(screen.getByText("No presets match.")).toBeInTheDocument();
    });

    it("filters to a single category via chips", async () => {
        const user = userEvent.setup();
        useAuthMock.mockReturnValue({ user: adminUser });
        renderWithClient(<McpPresetsPage />);
        await user.click(screen.getByRole("button", { name: /system/i }));
        expect(screen.queryByText("github")).not.toBeInTheDocument();
        expect(screen.getByText("filesystem")).toBeInTheDocument();
    });

    it("hides 'Use preset' actions for a non-admin", () => {
        useAuthMock.mockReturnValue({ user: normalUser });
        renderWithClient(<McpPresetsPage />);
        expect(screen.queryByText("Use preset")).not.toBeInTheDocument();
        expect(screen.queryByText("Add another")).not.toBeInTheDocument();
    });

    it("opens the form dialog pre-filled with the preset on 'Use preset' and redirects to /mcp?selected= on save", async () => {
        const user = userEvent.setup();
        useAuthMock.mockReturnValue({ user: adminUser });
        const push = vi.fn();
        useRouterMock.mockReturnValue({ push });
        renderWithClient(<McpPresetsPage />);

        await user.click(screen.getByText("Use preset"));
        expect(screen.getByTestId("mcp-form-dialog")).toHaveAttribute("data-open", "true");

        fireEvent.click(screen.getByText("save-preset"));
        expect(push).toHaveBeenCalledWith("/mcp?selected=new-1");
    });
});
