import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithQuery } from "./_render";
import {
    providerWithHealth,
    adapters as adapterList,
    adapterAzure,
} from "./_fixtures";
import { makeMutation, makeQuery } from "./_mocks";

vi.mock("@/lib/api/providers", () => ({
    providers: {
        useList: vi.fn(),
        useCreate: vi.fn(),
        useUpdate: vi.fn(),
        useDelete: vi.fn(),
        useCheckMany: vi.fn(),
        probe: vi.fn(),
        list: vi.fn(),
        keys: { all: ["providers"], list: () => ["providers", "list"], one: (id: string) => ["providers", id] },
    },
}));

vi.mock("@/lib/api/adapters", () => ({
    adapters: {
        useList: vi.fn(),
        list: vi.fn(),
        keys: { all: ["adapters"], list: () => ["adapters", "list"] },
    },
}));

vi.mock("sonner", () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// Use the actual barrel — it re-exports from the leaf modules above which are mocked
import { providers } from "@/lib/api/providers";
import type { ProviderProbeResult } from "@/lib/api/providers";
import { adapters } from "@/lib/api/adapters";
import { toast } from "sonner";
import { ProviderFormDialog } from "@/components/providers/provider-form-dialog";

function openDialog(props: Partial<React.ComponentProps<typeof ProviderFormDialog>> = {}) {
    return renderWithQuery(
        <ProviderFormDialog
            open
            onOpenChange={vi.fn()}
            mode="create"
            {...props}
        />,
    );
}

beforeEach(() => {
    vi.mocked(providers.useCreate).mockReturnValue(makeMutation());
    vi.mocked(providers.useUpdate).mockReturnValue(makeMutation());
    vi.mocked(adapters.useList).mockReturnValue(makeQuery({ data: adapterList }));
});

describe("ProviderFormDialog — create mode", () => {
    it("shows 'Add Provider' title", () => {
        openDialog();
        expect(screen.getByText("Add Provider")).toBeInTheDocument();
    });

    it("starts with empty name field", () => {
        openDialog();
        expect(screen.getByPlaceholderText("openai")).toHaveValue("");
    });

    it("starts with Auto-detect adapter selected", () => {
        openDialog();
        // The SelectTrigger's SelectValue span shows "Auto-detect"
        const combobox = screen.getByRole("combobox");
        expect(combobox).toHaveTextContent("Auto-detect");
    });

    it("starts with enabled=true (switch checked)", () => {
        openDialog();
        const sw = screen.getByRole("switch");
        expect(sw).toBeChecked();
    });

    it("api key field starts empty in create mode", () => {
        openDialog();
        const keyInput = screen.getByPlaceholderText("sk-...");
        expect(keyInput).toHaveValue("");
    });

    it("shows/hides api key on eye toggle", async () => {
        const user = userEvent.setup();
        openDialog();
        const keyInput = screen.getByPlaceholderText("sk-...");
        expect(keyInput).toHaveAttribute("type", "password");
        // find the toggle button (eye icon button)
        const toggleBtn = keyInput.closest("div")!.querySelector("button")!;
        await user.click(toggleBtn);
        expect(keyInput).toHaveAttribute("type", "text");
        await user.click(toggleBtn);
        expect(keyInput).toHaveAttribute("type", "password");
    });

    it("toasts error and blocks submit when name is empty", async () => {
        const user = userEvent.setup();
        openDialog();
        await user.click(screen.getByRole("button", { name: "Create" }));
        expect(vi.mocked(toast.error)).toHaveBeenCalledWith("Name required");
        expect(vi.mocked(providers.useCreate)().mutate).not.toHaveBeenCalled();
    });

    it("toasts error and blocks submit when base_url is empty", async () => {
        const user = userEvent.setup();
        openDialog();
        await user.type(screen.getByPlaceholderText("openai"), "my-provider");
        await user.click(screen.getByRole("button", { name: "Create" }));
        expect(vi.mocked(toast.error)).toHaveBeenCalledWith("base_url required");
        expect(vi.mocked(providers.useCreate)().mutate).not.toHaveBeenCalled();
    });

    it("shows inline parse error for invalid JSON", async () => {
        const user = userEvent.setup();
        openDialog();
        await user.type(screen.getByPlaceholderText("openai"), "my-prov");
        // Fill base_url
        const urlInput = screen.getByPlaceholderText("https://api.openai.com/v1");
        await user.type(urlInput, "https://example.com");
        // Replace default_params with invalid JSON using fireEvent to avoid userEvent {-escaping
        const textarea = screen.getByRole("textbox", { name: /Default params/i });
        await user.clear(textarea);
        await user.type(textarea, "bad json");
        await user.click(screen.getByRole("button", { name: "Create" }));
        // Parse error renders as a span with class text-destructive
        const errorEl = document.querySelector(".text-destructive");
        expect(errorEl).toBeTruthy();
        expect(vi.mocked(providers.useCreate)().mutate).not.toHaveBeenCalled();
    });

    it("submits without api_key when key field is blank", async () => {
        const user = userEvent.setup();
        const mutate = vi.fn();
        vi.mocked(providers.useCreate).mockReturnValue(makeMutation({ mutate }));
        openDialog();
        await user.type(screen.getByPlaceholderText("openai"), "myprov");
        await user.type(
            screen.getByPlaceholderText("https://api.openai.com/v1"),
            "https://example.com",
        );
        await user.click(screen.getByRole("button", { name: "Create" }));
        await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
        const arg = mutate.mock.calls[0][0];
        expect("api_key" in arg).toBe(false);
    });

    it("includes api_key in payload when typed", async () => {
        const user = userEvent.setup();
        const mutate = vi.fn();
        vi.mocked(providers.useCreate).mockReturnValue(makeMutation({ mutate }));
        openDialog();
        await user.type(screen.getByPlaceholderText("openai"), "myprov");
        await user.type(
            screen.getByPlaceholderText("https://api.openai.com/v1"),
            "https://example.com",
        );
        await user.type(screen.getByPlaceholderText("sk-..."), "sk-secret");
        await user.click(screen.getByRole("button", { name: "Create" }));
        await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
        const arg = mutate.mock.calls[0][0];
        expect(arg.api_key).toBe("sk-secret");
    });

    it("Test button is disabled when health check URL is blank", () => {
        openDialog();
        const testBtn = screen.getByRole("button", { name: /Test/i });
        expect(testBtn).toBeDisabled();
    });

    it("Test button calls providers.probe and toasts success", async () => {
        const user = userEvent.setup();
        vi.mocked(providers.probe).mockResolvedValue({ ok: true, latency_ms: 42 });
        openDialog();
        await user.type(
            screen.getByPlaceholderText(/must return/i),
            "https://health.example.com",
        );
        const testBtn = screen.getByRole("button", { name: /Test/i });
        expect(testBtn).not.toBeDisabled();
        await user.click(testBtn);
        await waitFor(() =>
            expect(vi.mocked(toast.success)).toHaveBeenCalledWith(
                expect.stringContaining("Healthy"),
            ),
        );
    });

    it("Test button toasts error on probe failure", async () => {
        const user = userEvent.setup();
        vi.mocked(providers.probe).mockResolvedValue({ ok: false, error: "timeout", latency_ms: 0 });
        openDialog();
        await user.type(screen.getByPlaceholderText(/must return/i), "https://h.e.com");
        await user.click(screen.getByRole("button", { name: /Test/i }));
        await waitFor(() =>
            expect(vi.mocked(toast.error)).toHaveBeenCalledWith(expect.stringContaining("timeout")),
        );
    });

    it("Test button toasts error on probe exception", async () => {
        const user = userEvent.setup();
        vi.mocked(providers.probe).mockRejectedValue(new Error("network down"));
        openDialog();
        await user.type(screen.getByPlaceholderText(/must return/i), "https://h.e.com");
        await user.click(screen.getByRole("button", { name: /Test/i }));
        await waitFor(() =>
            expect(vi.mocked(toast.error)).toHaveBeenCalledWith("network down"),
        );
    });

    it("shows API Version field when azure-openai adapter is selected", async () => {
        const user = userEvent.setup();
        openDialog();
        // Open the adapter Select
        const [combobox] = screen.getAllByRole("combobox");
        await user.click(combobox);
        const azureOption = await screen.findByRole("option", { name: "Azure OpenAI" });
        await user.click(azureOption);
        expect(await screen.findByLabelText(/API Version/i)).toBeInTheDocument();
    });

    it("hides API Version field when non-azure adapter is selected", async () => {
        const user = userEvent.setup();
        openDialog();
        const [combobox] = screen.getAllByRole("combobox");
        await user.click(combobox);
        const openaiOption = await screen.findByRole("option", { name: "OpenAI" });
        await user.click(openaiOption);
        expect(screen.queryByLabelText(/API Version/i)).toBeNull();
    });

    it("Test button toasts healthy without latency when latency_ms is null", async () => {
        const user = userEvent.setup();
        vi.mocked(providers.probe).mockResolvedValue({ ok: true, latency_ms: null } as unknown as ProviderProbeResult);
        openDialog();
        await user.type(screen.getByPlaceholderText(/must return/i), "https://h.e.com");
        await user.click(screen.getByRole("button", { name: /Test/i }));
        await waitFor(() =>
            expect(vi.mocked(toast.success)).toHaveBeenCalledWith("Healthy"),
        );
    });

    it("Test button toasts down with 'unknown' when probe has null error", async () => {
        const user = userEvent.setup();
        vi.mocked(providers.probe).mockResolvedValue({ ok: false, error: null } as unknown as ProviderProbeResult);
        openDialog();
        await user.type(screen.getByPlaceholderText(/must return/i), "https://h.e.com");
        await user.click(screen.getByRole("button", { name: /Test/i }));
        await waitFor(() =>
            expect(vi.mocked(toast.error)).toHaveBeenCalledWith("Down: unknown"),
        );
    });

    it("Test button toasts generic error for non-Error exception", async () => {
        const user = userEvent.setup();
        vi.mocked(providers.probe).mockRejectedValue("string error");
        openDialog();
        await user.type(screen.getByPlaceholderText(/must return/i), "https://h.e.com");
        await user.click(screen.getByRole("button", { name: /Test/i }));
        await waitFor(() =>
            expect(vi.mocked(toast.error)).toHaveBeenCalledWith("Health check failed"),
        );
    });

    it("renders without adapter options when adapterList is undefined", () => {
        vi.mocked(adapters.useList).mockReturnValue(makeQuery({ data: undefined }));
        openDialog();
        // Only the Auto-detect option should be available (no mapped adapter items)
        expect(screen.getByRole("combobox")).toBeInTheDocument();
    });

    it("disables buttons when mutation is pending", () => {
        vi.mocked(providers.useCreate).mockReturnValue(makeMutation({ isPending: true }));
        openDialog();
        expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
        expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
    });
});

describe("ProviderFormDialog — edit mode", () => {
    it("shows 'Edit Provider' title", () => {
        openDialog({ mode: "edit", provider: providerWithHealth });
        expect(screen.getByText("Edit Provider")).toBeInTheDocument();
    });

    it("pre-fills name from provider", () => {
        openDialog({ mode: "edit", provider: providerWithHealth });
        expect(screen.getByDisplayValue(providerWithHealth.name)).toBeInTheDocument();
    });

    it("api key field is blank even when has_api_key is true", () => {
        openDialog({ mode: "edit", provider: { ...providerWithHealth, has_api_key: true } });
        const keyInput = screen.getByPlaceholderText("Leave empty to keep existing key");
        expect(keyInput).toHaveValue("");
    });

    it("pre-fills base_url from provider", () => {
        openDialog({ mode: "edit", provider: providerWithHealth });
        expect(screen.getByDisplayValue(providerWithHealth.base_url)).toBeInTheDocument();
    });

    it("submits without api_key when key field left blank in edit mode", async () => {
        const user = userEvent.setup();
        const mutate = vi.fn();
        vi.mocked(providers.useUpdate).mockReturnValue(makeMutation({ mutate }));
        openDialog({ mode: "edit", provider: providerWithHealth });
        await user.click(screen.getByRole("button", { name: "Save" }));
        await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
        const { data } = mutate.mock.calls[0][0];
        expect("api_key" in data).toBe(false);
    });
});

describe("ProviderFormDialog — mutation callbacks", () => {
    it("toasts success and closes dialog when create succeeds", () => {
        const onOpenChange = vi.fn();
        renderWithQuery(<ProviderFormDialog open onOpenChange={onOpenChange} mode="create" />);
        const createOpts = vi.mocked(providers.useCreate).mock.calls[0][0] as { onSuccess: () => void };
        createOpts.onSuccess();
        expect(vi.mocked(toast.success)).toHaveBeenCalledWith("Provider created");
        expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it("toasts error when create mutation fails", () => {
        renderWithQuery(<ProviderFormDialog open onOpenChange={vi.fn()} mode="create" />);
        const createOpts = vi.mocked(providers.useCreate).mock.calls[0][0] as { onError: (e: Error) => void };
        createOpts.onError(new Error("Create failed"));
        expect(vi.mocked(toast.error)).toHaveBeenCalledWith("Create failed");
    });

    it("toasts success and closes dialog when update succeeds", () => {
        const onOpenChange = vi.fn();
        renderWithQuery(<ProviderFormDialog open onOpenChange={onOpenChange} mode="edit" provider={providerWithHealth} />);
        const updateOpts = vi.mocked(providers.useUpdate).mock.calls[0][0] as { onSuccess: () => void };
        updateOpts.onSuccess();
        expect(vi.mocked(toast.success)).toHaveBeenCalledWith("Provider updated");
        expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it("toasts error when update mutation fails", () => {
        renderWithQuery(<ProviderFormDialog open onOpenChange={vi.fn()} mode="edit" provider={providerWithHealth} />);
        const updateOpts = vi.mocked(providers.useUpdate).mock.calls[0][0] as { onError: (e: Error) => void };
        updateOpts.onError(new Error("Update failed"));
        expect(vi.mocked(toast.error)).toHaveBeenCalledWith("Update failed");
    });

    it("fills API Version field and includes it in create payload", async () => {
        const user = userEvent.setup();
        const mutate = vi.fn();
        vi.mocked(providers.useCreate).mockReturnValue(makeMutation({ mutate }));
        renderWithQuery(<ProviderFormDialog open onOpenChange={vi.fn()} mode="create" />);
        // Switch to azure adapter
        const [combobox] = screen.getAllByRole("combobox");
        await user.click(combobox);
        await user.click(await screen.findByRole("option", { name: "Azure OpenAI" }));
        await user.type(screen.getByPlaceholderText("openai"), "azure-prov");
        await user.type(
            screen.getByPlaceholderText("https://my-resource.openai.azure.com"),
            "https://azure.example.com",
        );
        const apiVersionInput = await screen.findByLabelText(/API Version/i);
        await user.type(apiVersionInput, "2024-10-21");
        await user.click(screen.getByRole("button", { name: "Create" }));
        await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
        const arg = mutate.mock.calls[0][0];
        expect(arg.api_version).toBe("2024-10-21");
    });

    it("Cancel button closes dialog", async () => {
        const user = userEvent.setup();
        const onOpenChange = vi.fn();
        renderWithQuery(<ProviderFormDialog open onOpenChange={onOpenChange} mode="create" />);
        await user.click(screen.getByRole("button", { name: "Cancel" }));
        expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it("fills doc/model page URLs included in payload", async () => {
        const user = userEvent.setup();
        const mutate = vi.fn();
        vi.mocked(providers.useCreate).mockReturnValue(makeMutation({ mutate }));
        renderWithQuery(<ProviderFormDialog open onOpenChange={vi.fn()} mode="create" />);
        await user.type(screen.getByPlaceholderText("openai"), "my-prov");
        await user.type(
            screen.getByPlaceholderText("https://api.openai.com/v1"),
            "https://api.example.com",
        );
        await user.type(screen.getByLabelText("Docs URL"), "https://docs.example.com");
        await user.type(screen.getByLabelText("Models page URL"), "https://models.example.com");
        await user.click(screen.getByRole("button", { name: "Create" }));
        await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
        const arg = mutate.mock.calls[0][0];
        expect(arg.document_page).toBe("https://docs.example.com");
        expect(arg.model_page).toBe("https://models.example.com");
    });

    it("submits with empty defaultParams (empty textarea → params={})", async () => {
        const user = userEvent.setup();
        const mutate = vi.fn();
        vi.mocked(providers.useCreate).mockReturnValue(makeMutation({ mutate }));
        renderWithQuery(<ProviderFormDialog open onOpenChange={vi.fn()} mode="create" />);
        await user.type(screen.getByPlaceholderText("openai"), "myprov");
        await user.type(
            screen.getByPlaceholderText("https://api.openai.com/v1"),
            "https://example.com",
        );
        // Clear the default params textarea to hit the empty-string branch
        const textarea = screen.getByLabelText("Default params (JSON)");
        await user.clear(textarea);
        await user.click(screen.getByRole("button", { name: "Create" }));
        await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
        expect(mutate.mock.calls[0][0].default_params).toEqual({});
    });
});
