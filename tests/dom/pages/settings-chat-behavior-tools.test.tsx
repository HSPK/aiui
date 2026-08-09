import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ChatSection } from "@/app/(dashboard)/settings/_sections/chat";
import { BehaviorSection } from "@/app/(dashboard)/settings/_sections/behavior";
import { ToolsSection } from "@/app/(dashboard)/settings/_sections/tools";
import { defaultUserPreferences, type UserPreferencesDTO } from "@/lib/schemas/preferences";
import { useDeviceSettingsStore } from "@/lib/stores/device-settings-store";
import type { ToolDTO } from "@/lib/schemas/tool";
import { mutationResult, queryResult, renderWithClient } from "./_helpers";

const useGetMock = vi.fn();
const useUpdateMock = vi.fn();
vi.mock("@/lib/api/preferences", () => ({
    preferences: {
        useGet: (...a: unknown[]) => useGetMock(...a),
        useUpdate: (...a: unknown[]) => useUpdateMock(...a),
    },
}));

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastError(...a), success: (...a: unknown[]) => toastSuccess(...a) } }));

const useToolListMock = vi.fn();
const useToolDeleteMock = vi.fn();
vi.mock("@/lib/api/tools", () => ({
    tools: {
        useList: (...a: unknown[]) => useToolListMock(...a),
        useDelete: (...a: unknown[]) => useToolDeleteMock(...a),
    },
}));

vi.mock("@/components/tools/tools-table", () => ({
    ToolsTable: ({
        tools,
        onEdit,
        onDelete,
    }: {
        tools: ToolDTO[];
        onEdit?: (t: ToolDTO) => void;
        onDelete?: (t: ToolDTO) => void;
    }) => (
        <div data-testid="tools-table">
            {tools.map((t) => (
                <div key={t.id}>
                    <span>{t.name}</span>
                    <button onClick={() => onEdit?.(t)}>edit-{t.name}</button>
                    <button onClick={() => onDelete?.(t)}>delete-{t.name}</button>
                </div>
            ))}
        </div>
    ),
}));

vi.mock("@/components/tools/tool-form-dialog", () => ({
    ToolFormDialog: ({
        open,
        mode,
        tool,
        onOpenChange,
    }: {
        open: boolean;
        mode: string;
        tool?: ToolDTO | null;
        onOpenChange: (open: boolean) => void;
    }) =>
        open ? (
            <div data-testid="tool-form-dialog" data-mode={mode}>
                {tool?.name ?? "new"}
                <button onClick={() => onOpenChange(false)}>close-tool-form</button>
            </div>
        ) : null,
}));

function makePrefs(overrides: Partial<UserPreferencesDTO> = {}): UserPreferencesDTO {
    return { ...defaultUserPreferences, ...overrides };
}

describe("ChatSection", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useGetMock.mockReturnValue(
            queryResult<UserPreferencesDTO>({
                data: makePrefs({ default_system_prompt: "Be helpful.", default_history_limit: 10 }),
            })
        );
        useUpdateMock.mockReturnValue(mutationResult({}));
    });

    it("renders the current system prompt and history limit", () => {
        renderWithClient(<ChatSection />);
        expect(screen.getByDisplayValue("Be helpful.")).toBeInTheDocument();
        expect(screen.getByDisplayValue("10")).toBeInTheDocument();
    });

    it("commits a changed system prompt on blur, and skips an unchanged one", async () => {
        const user = userEvent.setup();
        const mutate = vi.fn();
        useUpdateMock.mockReturnValue(mutationResult({ mutate }));
        renderWithClient(<ChatSection />);

        const textarea = screen.getByDisplayValue("Be helpful.");
        await user.click(textarea);
        await user.tab();
        expect(mutate).not.toHaveBeenCalled();

        await user.type(textarea, " Always.");
        await user.tab();
        expect(mutate).toHaveBeenCalledWith({ default_system_prompt: "Be helpful. Always." }, expect.anything());
    });

    it("reverts the prompt and toasts on a failed commit", async () => {
        const user = userEvent.setup();
        const mutate = vi.fn((_vars, opts?: { onError?: (e: Error) => void }) => opts?.onError?.(new Error("boom")));
        useUpdateMock.mockReturnValue(mutationResult({ mutate }));
        renderWithClient(<ChatSection />);

        const textarea = screen.getByDisplayValue("Be helpful.");
        await user.type(textarea, "!");
        await user.tab();
        expect(toastError).toHaveBeenCalledWith("boom");
        expect(textarea).toHaveValue("Be helpful.");
    });

    it("commits a valid history limit change on Enter", async () => {
        const user = userEvent.setup();
        const mutate = vi.fn();
        useUpdateMock.mockReturnValue(mutationResult({ mutate }));
        renderWithClient(<ChatSection />);

        const input = screen.getByDisplayValue("10");
        await user.clear(input);
        await user.type(input, "25{Enter}");
        expect(mutate).toHaveBeenCalledWith({ default_history_limit: 25 }, expect.anything());
    });

    it("rejects an out-of-range history limit and reverts", async () => {
        const user = userEvent.setup();
        const mutate = vi.fn();
        useUpdateMock.mockReturnValue(mutationResult({ mutate }));
        renderWithClient(<ChatSection />);

        const input = screen.getByDisplayValue("10");
        await user.clear(input);
        await user.type(input, "500");
        await user.tab();
        expect(toastError).toHaveBeenCalledWith("History limit must be between 1 and 50");
        expect(mutate).not.toHaveBeenCalled();
        expect(input).toHaveValue(10);
    });

    it("rejects a non-numeric history limit and reverts", async () => {
        const user = userEvent.setup();
        renderWithClient(<ChatSection />);
        const input = screen.getByDisplayValue("10");
        await user.clear(input);
        await user.type(input, "abc");
        await user.tab();
        expect(toastError).toHaveBeenCalledWith("History limit must be between 1 and 50");
        expect(input).toHaveValue(10);
    });

    it("reverts the history limit and toasts on a failed commit", async () => {
        const user = userEvent.setup();
        const mutate = vi.fn((_vars, opts?: { onError?: (e: Error) => void }) => opts?.onError?.(new Error("db locked")));
        useUpdateMock.mockReturnValue(mutationResult({ mutate }));
        renderWithClient(<ChatSection />);

        const input = screen.getByDisplayValue("10");
        await user.clear(input);
        await user.type(input, "20");
        await user.tab();
        expect(toastError).toHaveBeenCalledWith("db locked");
        expect(input).toHaveValue(10);
    });

    it("falls back to a generic message when the history limit commit fails with no error message", async () => {
        const user = userEvent.setup();
        const mutate = vi.fn((_vars, opts?: { onError?: (e: Error) => void }) => opts?.onError?.(new Error("")));
        useUpdateMock.mockReturnValue(mutationResult({ mutate }));
        renderWithClient(<ChatSection />);

        const input = screen.getByDisplayValue("10");
        await user.clear(input);
        await user.type(input, "20");
        await user.tab();
        expect(toastError).toHaveBeenCalledWith("Failed to save");
        expect(input).toHaveValue(10);
    });

    it("falls back to a generic message when the prompt commit fails with no error message", async () => {
        const user = userEvent.setup();
        const mutate = vi.fn((_vars, opts?: { onError?: (e: Error) => void }) => opts?.onError?.(new Error("")));
        useUpdateMock.mockReturnValue(mutationResult({ mutate }));
        renderWithClient(<ChatSection />);

        const textarea = screen.getByDisplayValue("Be helpful.");
        await user.type(textarea, "!");
        await user.tab();
        expect(toastError).toHaveBeenCalledWith("Failed to save");
    });

    it("falls back to the default preferences shape when the server hasn't returned data yet", () => {
        useGetMock.mockReturnValue(queryResult<UserPreferencesDTO>({ data: undefined }));
        renderWithClient(<ChatSection />);
        expect(screen.getByDisplayValue(defaultUserPreferences.default_system_prompt)).toBeInTheDocument();
    });

    it("skips the commit when the history limit is unchanged", async () => {
        const user = userEvent.setup();
        const mutate = vi.fn();
        useUpdateMock.mockReturnValue(mutationResult({ mutate }));
        renderWithClient(<ChatSection />);
        const input = screen.getByDisplayValue("10");
        await user.click(input);
        await user.tab();
        expect(mutate).not.toHaveBeenCalled();
    });
});

describe("BehaviorSection", () => {
    beforeEach(() => {
        useDeviceSettingsStore.setState({ sendOnEnter: true, showTimestamps: true, compactMode: false });
    });

    it("reflects the current device settings", () => {
        useDeviceSettingsStore.setState({ sendOnEnter: false, showTimestamps: true, compactMode: true });
        renderWithClient(<BehaviorSection />);
        const switches = screen.getAllByRole("switch");
        expect(switches[0]).toHaveAttribute("aria-checked", "false"); // Send on Enter
        expect(switches[1]).toHaveAttribute("aria-checked", "true"); // Show Timestamps
        expect(switches[2]).toHaveAttribute("aria-checked", "true"); // Compact Mode
    });

    it("toggles each switch and updates the device-settings store", async () => {
        const user = userEvent.setup();
        renderWithClient(<BehaviorSection />);
        const switches = screen.getAllByRole("switch");

        await user.click(switches[0]);
        expect(useDeviceSettingsStore.getState().sendOnEnter).toBe(false);

        await user.click(switches[1]);
        expect(useDeviceSettingsStore.getState().showTimestamps).toBe(false);

        await user.click(switches[2]);
        expect(useDeviceSettingsStore.getState().compactMode).toBe(true);
    });
});

function makeTool(overrides: Partial<ToolDTO> = {}): ToolDTO {
    return {
        id: "tool-1",
        name: "search_web",
        description: "Search the web",
        parameters: {},
        webhook_url: null,
        enabled: true,
        created_at: "2024-01-01T00:00:00.000Z",
        updated_at: "2024-01-01T00:00:00.000Z",
        ...overrides,
    };
}

describe("ToolsSection", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useToolListMock.mockReturnValue(queryResult<ToolDTO[]>({ data: [makeTool()] }));
        useToolDeleteMock.mockReturnValue(mutationResult({}));
    });

    it("renders the tool list", () => {
        renderWithClient(<ToolsSection />);
        expect(screen.getByText("search_web")).toBeInTheDocument();
    });

    it("renders an empty table when the list hasn't loaded yet", () => {
        useToolListMock.mockReturnValue(queryResult<ToolDTO[]>({ data: undefined }));
        renderWithClient(<ToolsSection />);
        expect(screen.getByTestId("tools-table")).toBeEmptyDOMElement();
    });

    it("opens the create dialog", async () => {
        const user = userEvent.setup();
        renderWithClient(<ToolsSection />);
        await user.click(screen.getByRole("button", { name: /Add tool/ }));
        expect(screen.getByTestId("tool-form-dialog")).toHaveAttribute("data-mode", "create");
    });

    it("opens the edit dialog for a tool", async () => {
        const user = userEvent.setup();
        renderWithClient(<ToolsSection />);
        await user.click(screen.getByText("edit-search_web"));
        const dialog = screen.getByTestId("tool-form-dialog");
        expect(dialog).toHaveAttribute("data-mode", "edit");
        expect(dialog).toHaveTextContent("search_web");
    });

    it("deletes a tool via the confirm dialog", async () => {
        const user = userEvent.setup();
        const mutate = vi.fn();
        useToolDeleteMock.mockReturnValue(mutationResult({ mutate }));
        renderWithClient(<ToolsSection />);

        await user.click(screen.getByText("delete-search_web"));
        expect(screen.getByText("Delete tool?")).toBeInTheDocument();
        const dialog = screen.getByRole("alertdialog");
        expect(within(dialog).getByText("search_web", { selector: "b" })).toBeInTheDocument();
        await user.click(within(dialog).getByRole("button", { name: "Delete" }));
        expect(mutate).toHaveBeenCalledWith("tool-1");
    });

    it("closes the tool form dialog via its onOpenChange", async () => {
        const user = userEvent.setup();
        renderWithClient(<ToolsSection />);
        await user.click(screen.getByRole("button", { name: /Add tool/ }));
        expect(screen.getByTestId("tool-form-dialog")).toBeInTheDocument();
        await user.click(screen.getByText("close-tool-form"));
        expect(screen.queryByTestId("tool-form-dialog")).not.toBeInTheDocument();
    });

    it("cancels the delete confirm dialog without deleting", async () => {
        const user = userEvent.setup();
        const mutate = vi.fn();
        useToolDeleteMock.mockReturnValue(mutationResult({ mutate }));
        renderWithClient(<ToolsSection />);
        await user.click(screen.getByText("delete-search_web"));
        expect(screen.getByRole("alertdialog")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Cancel" }));
        expect(mutate).not.toHaveBeenCalled();
        expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });

    it("runs the delete mutation's onSuccess/onError callbacks, including the generic fallback message", () => {
        let onSuccess: (() => void) | undefined;
        let onError: ((e: Error) => void) | undefined;
        useToolDeleteMock.mockImplementation((opts: { onSuccess?: () => void; onError?: (e: Error) => void }) => {
            onSuccess = opts.onSuccess;
            onError = opts.onError;
            return mutationResult({});
        });
        renderWithClient(<ToolsSection />);
        act(() => {
            onSuccess?.();
        });
        expect(toastSuccess).toHaveBeenCalledWith("Tool deleted");
        onError?.(new Error("locked"));
        expect(toastError).toHaveBeenCalledWith("locked");
        onError?.(new Error(""));
        expect(toastError).toHaveBeenCalledWith("Delete failed");
    });
});
