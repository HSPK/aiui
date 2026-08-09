import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { ApiKeyDTO, ApiKeyCreatedDTO } from "@/lib/schemas/apikey";
import { mutationResult, queryResult, renderWithClient } from "./_helpers";

const useListMock = vi.fn();
const useCreateMock = vi.fn();
const useDeleteMock = vi.fn();
vi.mock("@/lib/api/apikeys", () => ({
    apiKeys: {
        useList: (...a: unknown[]) => useListMock(...a),
        useCreate: (...a: unknown[]) => useCreateMock(...a),
        useDelete: (...a: unknown[]) => useDeleteMock(...a),
    },
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) } }));

const copyToClipboardMock = vi.fn();
vi.mock("@/lib/clipboard", () => ({ copyToClipboard: (...a: unknown[]) => copyToClipboardMock(...a) }));

import ApiKeysPage from "@/app/(dashboard)/settings/api-keys/page";

function key(overrides: Partial<ApiKeyDTO> = {}): ApiKeyDTO {
    return {
        id: "key-1",
        name: "my-backend",
        prefix: "sk-abcd",
        last_used_at: null,
        expires_at: null,
        created_at: "2024-01-01T00:00:00.000Z",
        ...overrides,
    };
}

describe("ApiKeysPage", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useListMock.mockReturnValue(queryResult<ApiKeyDTO[]>({ data: [] }));
        useCreateMock.mockReturnValue(mutationResult<ApiKeyCreatedDTO>({}));
        useDeleteMock.mockReturnValue(mutationResult({}));
        copyToClipboardMock.mockResolvedValue(true);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("shows a loading state while fetching", () => {
        useListMock.mockReturnValue(queryResult<ApiKeyDTO[]>({ data: undefined, isLoading: true }));
        renderWithClient(<ApiKeysPage />);
        expect(screen.getByText("Loading…")).toBeInTheDocument();
    });

    it("shows an empty-state row when there are no keys", () => {
        renderWithClient(<ApiKeysPage />);
        expect(screen.getByText("No API keys yet.")).toBeInTheDocument();
    });

    it("renders key rows with prefix, formatted dates, and 'Never'/'—' placeholders", () => {
        useListMock.mockReturnValue(queryResult<ApiKeyDTO[]>({ data: [key()] }));
        renderWithClient(<ApiKeysPage />);

        expect(screen.getByText("my-backend")).toBeInTheDocument();
        expect(screen.getByText("sk-abcd…")).toBeInTheDocument();
        expect(screen.getByText("Never")).toBeInTheDocument();
        expect(screen.getByText("—")).toBeInTheDocument();
    });

    it("styles a still-valid future expiry as muted and shows the formatted date", () => {
        useListMock.mockReturnValue(
            queryResult<ApiKeyDTO[]>({ data: [key({ expires_at: "2999-01-01T00:00:00.000Z", last_used_at: "2024-02-01T00:00:00.000Z" })] })
        );
        renderWithClient(<ApiKeysPage />);
        const cells = screen.getAllByRole("cell");
        const expiresCell = cells[3];
        expect(expiresCell.querySelector("span.text-muted-foreground")).toBeTruthy();
        expect(expiresCell.querySelector("span.text-destructive")).toBeFalsy();
    });

    it("styles an already-expired key's date as destructive", () => {
        useListMock.mockReturnValue(queryResult<ApiKeyDTO[]>({ data: [key({ expires_at: "2000-01-01T00:00:00.000Z" })] }));
        renderWithClient(<ApiKeysPage />);
        const destructive = document.querySelector("span.text-destructive");
        expect(destructive).toBeTruthy();
    });

    it("opens the create dialog, keeps Create disabled until a name is entered, and cancels cleanly", async () => {
        const user = userEvent.setup();
        renderWithClient(<ApiKeysPage />);

        await user.click(screen.getByRole("button", { name: /create key/i }));
        const dialog = screen.getByRole("dialog");
        expect(within(dialog).getByText("New API Key")).toBeInTheDocument();
        expect(within(dialog).getByRole("button", { name: "Create" })).toBeDisabled();

        await user.type(within(dialog).getByLabelText("Name"), "  ");
        expect(within(dialog).getByRole("button", { name: "Create" })).toBeDisabled();

        await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("creates a never-expiring key with the trimmed name", async () => {
        const user = userEvent.setup();
        const mutate = vi.fn();
        useCreateMock.mockReturnValue(mutationResult<ApiKeyCreatedDTO>({ mutate }));
        renderWithClient(<ApiKeysPage />);

        await user.click(screen.getByRole("button", { name: /create key/i }));
        const dialog = screen.getByRole("dialog");
        await user.type(within(dialog).getByLabelText("Name"), "  ci-runner  ");
        await user.click(within(dialog).getByRole("button", { name: "Create" }));

        expect(mutate).toHaveBeenCalledWith({ name: "ci-runner", expires_at: null });
    });

    it("creates a key with a computed expiry timestamp for a 30-day option", async () => {
        const user = userEvent.setup();
        const mutate = vi.fn();
        useCreateMock.mockReturnValue(mutationResult<ApiKeyCreatedDTO>({ mutate }));
        renderWithClient(<ApiKeysPage />);

        const before = Date.now();
        await user.click(screen.getByRole("button", { name: /create key/i }));
        const dialog = screen.getByRole("dialog");
        await user.type(within(dialog).getByLabelText("Name"), "temp-key");
        await user.selectOptions(within(dialog).getByLabelText("Expiration"), "30");
        await user.click(within(dialog).getByRole("button", { name: "Create" }));
        const after = Date.now();

        expect(mutate).toHaveBeenCalledTimes(1);
        const call = mutate.mock.calls[0][0] as { name: string; expires_at: string };
        expect(call.name).toBe("temp-key");
        const expiresAt = Date.parse(call.expires_at);
        // Allow the test's own wall-clock execution time either side of the
        // 30-day offset instead of freezing Date.now() (fake timers were
        // found to hang real userEvent interactions in this suite).
        expect(expiresAt).toBeGreaterThanOrEqual(before + 30 * 86400_000);
        expect(expiresAt).toBeLessThanOrEqual(after + 30 * 86400_000);
    });

    it("reveals the new secret dialog on create success and closes the create dialog", () => {
        let onSuccess: ((k: ApiKeyCreatedDTO) => void) | undefined;
        useCreateMock.mockImplementation((opts: { onSuccess?: (k: ApiKeyCreatedDTO) => void }) => {
            onSuccess = opts.onSuccess;
            return mutationResult<ApiKeyCreatedDTO>({});
        });
        renderWithClient(<ApiKeysPage />);
        act(() => {
            onSuccess?.({ id: "k1", name: "temp-key", prefix: "sk-xy", last_used_at: null, expires_at: null, created_at: "2024-01-01T00:00:00.000Z", key: "sk-full-secret-value" });
        });

        expect(screen.getByText("Key created: temp-key")).toBeInTheDocument();
        expect(screen.getByText("sk-full-secret-value")).toBeInTheDocument();
    });

    it("copies the secret to the clipboard and toasts success", async () => {
        const user = userEvent.setup();
        let onSuccess: ((k: ApiKeyCreatedDTO) => void) | undefined;
        useCreateMock.mockImplementation((opts: { onSuccess?: (k: ApiKeyCreatedDTO) => void }) => {
            onSuccess = opts.onSuccess;
            return mutationResult<ApiKeyCreatedDTO>({});
        });
        copyToClipboardMock.mockResolvedValue(true);
        renderWithClient(<ApiKeysPage />);
        act(() => {
            onSuccess?.({ id: "k1", name: "temp-key", prefix: "sk-xy", last_used_at: null, expires_at: null, created_at: "2024-01-01T00:00:00.000Z", key: "sk-full-secret-value" });
        });

        await user.click(screen.getByRole("button", { name: "" }));
        expect(copyToClipboardMock).toHaveBeenCalledWith("sk-full-secret-value");
        expect(toastSuccess).toHaveBeenCalledWith("Copied to clipboard");
    });

    it("toasts a manual-copy fallback message when the clipboard copy fails", async () => {
        const user = userEvent.setup();
        let onSuccess: ((k: ApiKeyCreatedDTO) => void) | undefined;
        useCreateMock.mockImplementation((opts: { onSuccess?: (k: ApiKeyCreatedDTO) => void }) => {
            onSuccess = opts.onSuccess;
            return mutationResult<ApiKeyCreatedDTO>({});
        });
        copyToClipboardMock.mockResolvedValue(false);
        renderWithClient(<ApiKeysPage />);
        act(() => {
            onSuccess?.({ id: "k1", name: "temp-key", prefix: "sk-xy", last_used_at: null, expires_at: null, created_at: "2024-01-01T00:00:00.000Z", key: "sk-full-secret-value" });
        });

        const dialog = screen.getByRole("dialog");
        const copyButton = within(dialog).getAllByRole("button")[0];
        await user.click(copyButton);
        expect(toastError).toHaveBeenCalledWith("Copy failed — select the key manually");
    });

    it("dismisses the secret dialog via Done", async () => {
        const user = userEvent.setup();
        let onSuccess: ((k: ApiKeyCreatedDTO) => void) | undefined;
        useCreateMock.mockImplementation((opts: { onSuccess?: (k: ApiKeyCreatedDTO) => void }) => {
            onSuccess = opts.onSuccess;
            return mutationResult<ApiKeyCreatedDTO>({});
        });
        renderWithClient(<ApiKeysPage />);
        act(() => {
            onSuccess?.({ id: "k1", name: "temp-key", prefix: "sk-xy", last_used_at: null, expires_at: null, created_at: "2024-01-01T00:00:00.000Z", key: "sk-full-secret-value" });
        });
        await user.click(screen.getByRole("button", { name: "Done" }));
        expect(screen.queryByText("Key created: temp-key")).not.toBeInTheDocument();
    });

    it("shows an error toast when creation fails", () => {
        let onError: ((e: Error) => void) | undefined;
        useCreateMock.mockImplementation((opts: { onError?: (e: Error) => void }) => {
            onError = opts.onError;
            return mutationResult<ApiKeyCreatedDTO>({});
        });
        renderWithClient(<ApiKeysPage />);
        onError?.(new Error("name already exists"));
        expect(toastError).toHaveBeenCalledWith("name already exists");
    });

    it("falls back to a generic message when the creation error has no message", () => {
        let onError: ((e: Error) => void) | undefined;
        useCreateMock.mockImplementation((opts: { onError?: (e: Error) => void }) => {
            onError = opts.onError;
            return mutationResult<ApiKeyCreatedDTO>({});
        });
        renderWithClient(<ApiKeysPage />);
        onError?.(new Error(""));
        expect(toastError).toHaveBeenCalledWith("Create failed");
    });

    it("closes the secret dialog via the dialog's close (X) button", async () => {
        const user = userEvent.setup();
        let onSuccess: ((k: ApiKeyCreatedDTO) => void) | undefined;
        useCreateMock.mockImplementation((opts: { onSuccess?: (k: ApiKeyCreatedDTO) => void }) => {
            onSuccess = opts.onSuccess;
            return mutationResult<ApiKeyCreatedDTO>({});
        });
        renderWithClient(<ApiKeysPage />);
        act(() => {
            onSuccess?.({ id: "k1", name: "temp-key", prefix: "sk-xy", last_used_at: null, expires_at: null, created_at: "2024-01-01T00:00:00.000Z", key: "sk-full-secret-value" });
        });
        expect(screen.getByText("Key created: temp-key")).toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "Close" }));
        expect(screen.queryByText("Key created: temp-key")).not.toBeInTheDocument();
    });

    it("revokes a key through the real confirm dialog", async () => {
        const user = userEvent.setup();
        const mutate = vi.fn();
        useDeleteMock.mockReturnValue(mutationResult({ mutate }));
        useListMock.mockReturnValue(queryResult<ApiKeyDTO[]>({ data: [key({ id: "key-9", name: "ci-runner" })] }));
        renderWithClient(<ApiKeysPage />);

        await user.click(screen.getByRole("button", { name: "" }));
        const dialog = screen.getByRole("alertdialog");
        expect(within(dialog).getByText("ci-runner")).toBeInTheDocument();
        await user.click(within(dialog).getByRole("button", { name: "Revoke" }));
        expect(mutate).toHaveBeenCalledWith("key-9");
    });

    it("shows a success toast when revocation succeeds", () => {
        let onSuccess: (() => void) | undefined;
        useDeleteMock.mockImplementation((opts: { onSuccess?: () => void }) => {
            onSuccess = opts.onSuccess;
            return mutationResult({});
        });
        renderWithClient(<ApiKeysPage />);
        onSuccess?.();
        expect(toastSuccess).toHaveBeenCalledWith("API key revoked");
    });

    it("shows an error toast when revocation fails", () => {
        let onError: ((e: Error) => void) | undefined;
        useDeleteMock.mockImplementation((opts: { onError?: (e: Error) => void }) => {
            onError = opts.onError;
            return mutationResult({});
        });
        renderWithClient(<ApiKeysPage />);
        onError?.(new Error("not found"));
        expect(toastError).toHaveBeenCalledWith("not found");
    });

    it("falls back to a generic message when the revocation error has no message", () => {
        let onError: ((e: Error) => void) | undefined;
        useDeleteMock.mockImplementation((opts: { onError?: (e: Error) => void }) => {
            onError = opts.onError;
            return mutationResult({});
        });
        renderWithClient(<ApiKeysPage />);
        onError?.(new Error(""));
        expect(toastError).toHaveBeenCalledWith("Delete failed");
    });

    it("cancels the revoke confirm dialog without deleting", async () => {
        const user = userEvent.setup();
        const mutate = vi.fn();
        useDeleteMock.mockReturnValue(mutationResult({ mutate }));
        useListMock.mockReturnValue(queryResult<ApiKeyDTO[]>({ data: [key({ id: "key-9", name: "ci-runner" })] }));
        renderWithClient(<ApiKeysPage />);

        await user.click(screen.getByRole("button", { name: "" }));
        const dialog = screen.getByRole("alertdialog");
        await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
        expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
        expect(mutate).not.toHaveBeenCalled();
    });
});
