import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ProviderDetailPage from "@/app/(dashboard)/providers/[name]/page";
import type { ProviderDTO } from "@/lib/schemas/provider";
import type { ModelDTO } from "@/lib/schemas/model";
import { adminUser, makeRouter, mutationResult, normalUser, queryResult, renderWithClient } from "./_helpers";

const useParamsMock = vi.fn();
const useRouterMock = vi.fn();
vi.mock("next/navigation", () => ({
    useParams: () => useParamsMock(),
    useRouter: () => useRouterMock(),
}));

const useAuthMock = vi.fn();
vi.mock("@/context/auth-context", () => ({ useAuth: () => useAuthMock() }));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) } }));

const useProviderGetMock = vi.fn();
const useProviderModelsMock = vi.fn();
const useReloadMock = vi.fn();
const useCheckMock = vi.fn();
vi.mock("@/lib/api/providers", () => ({
    providers: {
        useGet: (...a: unknown[]) => useProviderGetMock(...a),
        useModels: (...a: unknown[]) => useProviderModelsMock(...a),
        useReload: (...a: unknown[]) => useReloadMock(...a),
        useCheck: (...a: unknown[]) => useCheckMock(...a),
    },
}));

const useModelDeleteMock = vi.fn();
vi.mock("@/lib/api/models", () => ({ models: { useDelete: (...a: unknown[]) => useModelDeleteMock(...a) } }));

vi.mock("@/components/ProviderIcon", () => ({
    ProviderIcon: ({ providerName }: { providerName: string }) => <span data-testid="provider-icon">{providerName}</span>,
}));

vi.mock("@/components/providers/models-table", () => ({
    ModelsTable: ({
        models,
        onEdit,
        onDelete,
    }: {
        models: ModelDTO[];
        onEdit?: (m: ModelDTO) => void;
        onDelete?: (m: ModelDTO) => void;
    }) => (
        <div data-testid="models-table">
            {models.map((m) => (
                <div key={m.id}>
                    <span>{m.name}</span>
                    {onEdit && <button onClick={() => onEdit(m)}>edit-{m.name}</button>}
                    {onDelete && <button onClick={() => onDelete(m)}>delete-{m.name}</button>}
                </div>
            ))}
        </div>
    ),
}));

vi.mock("@/components/providers/model-form-dialog", () => ({
    ModelFormDialog: ({
        open,
        mode,
        model,
        defaultProviderId,
        onOpenChange,
    }: {
        open: boolean;
        mode: string;
        model?: ModelDTO | null;
        defaultProviderId?: string;
        onOpenChange: (open: boolean) => void;
    }) =>
        open ? (
            <div data-testid="model-form-dialog" data-mode={mode} data-default-provider-id={defaultProviderId}>
                {model?.name ?? "new"}
                <button onClick={() => onOpenChange(false)}>close-model-form</button>
            </div>
        ) : null,
}));

function makeProvider(overrides: Partial<ProviderDTO> = {}): ProviderDTO {
    return {
        id: "prov-1",
        name: "openai",
        provider_name: "OpenAI",
        adapter_id: "openai",
        base_url: "https://api.openai.com/v1",
        proxy: "https://api.openai.com/v1",
        api_version: null,
        has_api_key: true,
        default_params: {},
        document_page: "https://platform.openai.com/docs",
        model_page: "https://platform.openai.com/models",
        health_check_url: null,
        last_health_status: null,
        last_health_checked_at: null,
        last_health_error: null,
        is_local: false,
        enabled: true,
        n_models: 2,
        created_at: "2024-01-01T00:00:00.000Z",
        updated_at: "2024-01-01T00:00:00.000Z",
        ...overrides,
    };
}

function makeModel(overrides: Partial<ModelDTO> = {}): ModelDTO {
    return {
        id: "model-1",
        name: "gpt-4",
        model_id: "gpt-4",
        proxy: null,
        timeout: 30,
        max_retries: 2,
        default_params: {},
        type: "chat",
        api_variant_id: null,
        resolved_variant_id: "chat.completions",
        pricing: null,
        output_dimension: null,
        context_window: 8192,
        max_tokens: 4096,
        description: null,
        knowledge_date: null,
        provider: "openai",
        provider_id: "prov-1",
        is_local: false,
        enabled: true,
        is_discovered: false,
        meta: null,
        ...overrides,
    };
}

describe("ProviderDetailPage", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useParamsMock.mockReturnValue({ name: "openai" });
        useRouterMock.mockReturnValue(makeRouter());
        useAuthMock.mockReturnValue({ user: adminUser });
        useProviderGetMock.mockReturnValue(queryResult<ProviderDTO>({ data: makeProvider() }));
        useProviderModelsMock.mockReturnValue(queryResult<ModelDTO[]>({ data: [makeModel()] }));
        useReloadMock.mockReturnValue(mutationResult({}));
        useCheckMock.mockReturnValue(mutationResult({}));
        useModelDeleteMock.mockReturnValue(mutationResult({}));
    });

    it("shows a skeleton while the provider is loading", () => {
        useProviderGetMock.mockReturnValue(queryResult<ProviderDTO>({ data: undefined, isLoading: true }));
        renderWithClient(<ProviderDetailPage />);
        expect(screen.queryByText("OpenAI")).not.toBeInTheDocument();
    });

    it("shows a not-found state and navigates back to /providers", async () => {
        const user = userEvent.setup();
        const router = makeRouter();
        useRouterMock.mockReturnValue(router);
        useProviderGetMock.mockReturnValue(queryResult<ProviderDTO>({ data: undefined, isLoading: false }));
        renderWithClient(<ProviderDetailPage />);
        expect(screen.getByText("Provider not found")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: /Back to Providers/ }));
        expect(router.push).toHaveBeenCalledWith("/providers");
    });

    it("renders the identity card, doc/model links, and model summary counts", () => {
        renderWithClient(<ProviderDetailPage />);
        expect(screen.getByRole("heading", { name: "OpenAI", level: 1 })).toBeInTheDocument();
        expect(screen.getByTestId("provider-icon")).toHaveTextContent("OpenAI");
        expect(screen.getByRole("link", { name: /Models/ })).toHaveAttribute(
            "href",
            "https://platform.openai.com/models"
        );
        expect(screen.getByRole("link", { name: /Docs/ })).toHaveAttribute(
            "href",
            "https://platform.openai.com/docs"
        );
        expect(screen.getByText("https://api.openai.com/v1")).toBeInTheDocument();
        expect(screen.getByText("1 model · 0 discovered · 1 override")).toBeInTheDocument();
    });

    it("omits the model/doc links and health check button when unset", () => {
        useProviderGetMock.mockReturnValue(
            queryResult<ProviderDTO>({
                data: makeProvider({ model_page: "", document_page: "", health_check_url: null, proxy: "" }),
            })
        );
        renderWithClient(<ProviderDetailPage />);
        expect(screen.queryByRole("link", { name: /Models/ })).not.toBeInTheDocument();
        expect(screen.queryByRole("link", { name: /Docs/ })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /^Check$/ })).not.toBeInTheDocument();
    });

    it("shows an adapter badge (with azure- prefix humanized) for non-openai adapters", () => {
        useProviderGetMock.mockReturnValue(
            queryResult<ProviderDTO>({ data: makeProvider({ adapter_id: "azure-openai" }) })
        );
        renderWithClient(<ProviderDetailPage />);
        expect(screen.getByText("Azure openai")).toBeInTheDocument();
    });

    it("pluralizes the model/override counts for multiple models", () => {
        useProviderModelsMock.mockReturnValue(
            queryResult<ModelDTO[]>({
                data: [makeModel(), makeModel({ id: "model-2", name: "gpt-4o", is_discovered: true })],
            })
        );
        renderWithClient(<ProviderDetailPage />);
        expect(screen.getByText("2 models · 1 discovered · 1 override")).toBeInTheDocument();
    });

    it("runs the configured health check and reports success", async () => {
        const user = userEvent.setup();
        const mutate = vi.fn();
        useProviderGetMock.mockReturnValue(
            queryResult<ProviderDTO>({ data: makeProvider({ health_check_url: "https://api.openai.com/health" }) })
        );
        useCheckMock.mockReturnValue(mutationResult({ mutate }));
        renderWithClient(<ProviderDetailPage />);
        await user.click(screen.getByRole("button", { name: /^Check$/ }));
        expect(mutate).toHaveBeenCalled();
    });

    it("refreshes the model list via the Refresh button", async () => {
        const user = userEvent.setup();
        const mutate = vi.fn();
        useReloadMock.mockReturnValue(mutationResult({ mutate }));
        renderWithClient(<ProviderDetailPage />);
        await user.click(screen.getByRole("button", { name: /Refresh/ }));
        expect(mutate).toHaveBeenCalled();
    });

    it("shows the health pill once a check has run (ok/down/unchecked)", () => {
        useProviderGetMock.mockReturnValue(
            queryResult<ProviderDTO>({
                data: makeProvider({ health_check_url: "https://api.openai.com/health", last_health_status: "down", last_health_error: "timeout" }),
            })
        );
        renderWithClient(<ProviderDetailPage />);
        expect(screen.getByText("Down")).toBeInTheDocument();
    });

    it("shows a loading skeleton for the models table", () => {
        useProviderModelsMock.mockReturnValue(queryResult<ModelDTO[]>({ data: undefined, isLoading: true }));
        renderWithClient(<ProviderDetailPage />);
        expect(screen.queryByTestId("models-table")).not.toBeInTheDocument();
    });

    it("shows an empty state with a Refresh Models CTA when there are no models", async () => {
        const user = userEvent.setup();
        const mutate = vi.fn();
        useReloadMock.mockReturnValue(mutationResult({ mutate }));
        useProviderModelsMock.mockReturnValue(queryResult<ModelDTO[]>({ data: [] }));
        renderWithClient(<ProviderDetailPage />);
        expect(screen.getByText("No models exposed by this provider yet.")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: /Refresh Models/ }));
        expect(mutate).toHaveBeenCalled();
    });

    it("lets an admin add a model with this provider preselected", async () => {
        const user = userEvent.setup();
        renderWithClient(<ProviderDetailPage />);
        await user.click(screen.getByRole("button", { name: /Add model/ }));
        const dialog = screen.getByTestId("model-form-dialog");
        expect(dialog).toHaveAttribute("data-mode", "create");
        expect(dialog).toHaveAttribute("data-default-provider-id", "prov-1");
    });

    it("hides Add model / edit / delete for a non-admin", () => {
        useAuthMock.mockReturnValue({ user: normalUser });
        renderWithClient(<ProviderDetailPage />);
        expect(screen.queryByRole("button", { name: /Add model/ })).not.toBeInTheDocument();
        expect(screen.queryByText("edit-gpt-4")).not.toBeInTheDocument();
        expect(screen.queryByText("delete-gpt-4")).not.toBeInTheDocument();
    });

    it("edits a non-discovered model in 'edit' mode and a discovered one in 'create' mode", async () => {
        const user = userEvent.setup();
        useProviderModelsMock.mockReturnValue(
            queryResult<ModelDTO[]>({
                data: [makeModel(), makeModel({ id: "model-2", name: "disco", is_discovered: true })],
            })
        );
        renderWithClient(<ProviderDetailPage />);

        await user.click(screen.getByText("edit-gpt-4"));
        expect(screen.getByTestId("model-form-dialog")).toHaveAttribute("data-mode", "edit");

        await user.click(screen.getByText("edit-disco"));
        expect(screen.getByTestId("model-form-dialog")).toHaveAttribute("data-mode", "create");
    });

    it("deletes a model via the confirm dialog", async () => {
        const user = userEvent.setup();
        const mutate = vi.fn();
        useModelDeleteMock.mockReturnValue(mutationResult({ mutate }));
        renderWithClient(<ProviderDetailPage />);

        await user.click(screen.getByText("delete-gpt-4"));
        expect(screen.getByText("Delete model?")).toBeInTheDocument();
        const dialog = screen.getByRole("alertdialog");
        expect(within(dialog).getByText("gpt-4", { selector: "b" })).toBeInTheDocument();
        await user.click(within(dialog).getByRole("button", { name: "Delete" }));
        expect(mutate).toHaveBeenCalledWith("model-1");
    });

    it("navigates back to /providers via the breadcrumb button", async () => {
        const user = userEvent.setup();
        const router = makeRouter();
        useRouterMock.mockReturnValue(router);
        renderWithClient(<ProviderDetailPage />);
        await user.click(screen.getByRole("button", { name: "Providers" }));
        expect(router.push).toHaveBeenCalledWith("/providers");
    });

    it("falls back to an empty slug when the route param is missing", () => {
        useParamsMock.mockReturnValue({});
        renderWithClient(<ProviderDetailPage />);
        expect(useProviderGetMock).toHaveBeenCalledWith("");
        expect(useProviderModelsMock).toHaveBeenCalledWith("");
    });

    it("cancels the delete confirm dialog without deleting", async () => {
        const user = userEvent.setup();
        const mutate = vi.fn();
        useModelDeleteMock.mockReturnValue(mutationResult({ mutate }));
        renderWithClient(<ProviderDetailPage />);
        await user.click(screen.getByText("delete-gpt-4"));
        expect(screen.getByRole("alertdialog")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Cancel" }));
        expect(mutate).not.toHaveBeenCalled();
        expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });

    it("closes the model form dialog via its onOpenChange", async () => {
        const user = userEvent.setup();
        renderWithClient(<ProviderDetailPage />);
        await user.click(screen.getByRole("button", { name: /Add model/ }));
        expect(screen.getByTestId("model-form-dialog")).toBeInTheDocument();
        await user.click(screen.getByText("close-model-form"));
        expect(screen.queryByTestId("model-form-dialog")).not.toBeInTheDocument();
    });

    it("shows spinner classes while the health check and refresh mutations are pending", () => {
        useProviderGetMock.mockReturnValue(
            queryResult<ProviderDTO>({ data: makeProvider({ health_check_url: "https://api.openai.com/health" }) })
        );
        useProviderModelsMock.mockReturnValue(queryResult<ModelDTO[]>({ data: [] }));
        useCheckMock.mockReturnValue(mutationResult({ isPending: true }));
        useReloadMock.mockReturnValue(mutationResult({ isPending: true }));
        renderWithClient(<ProviderDetailPage />);
        expect(screen.getByRole("button", { name: /^Check$/ })).toBeDisabled();
        expect(document.querySelector(".lucide-activity")).toHaveClass("animate-pulse");
        // Two Refresh buttons render when the model list is empty: the
        // header one and the empty-state CTA. Both share isPending.
        const refreshButtons = screen.getAllByRole("button", { name: /Refresh/ });
        refreshButtons.forEach((btn) => expect(btn).toBeDisabled());
        const spinningIcons = document.querySelectorAll(".lucide-refresh-ccw.animate-spin");
        expect(spinningIcons.length).toBeGreaterThanOrEqual(2);
    });

    it("runs the refresh mutation's onSuccess/onError callbacks", () => {
        let onSuccess: (() => void) | undefined;
        let onError: ((e: Error) => void) | undefined;
        useReloadMock.mockImplementation((opts: { onSuccess?: () => void; onError?: (e: Error) => void }) => {
            onSuccess = opts.onSuccess;
            onError = opts.onError;
            return mutationResult({});
        });
        renderWithClient(<ProviderDetailPage />);
        onSuccess?.();
        expect(toastSuccess).toHaveBeenCalledWith("Refreshed model list");
        onError?.(new Error("upstream down"));
        expect(toastError).toHaveBeenCalledWith("Refresh failed: upstream down");
    });

    it("runs the health-check mutation's onSuccess/onError callbacks across ok/latency/error permutations", () => {
        let onSuccess: ((res: { ok: boolean; error?: string; latency_ms?: number }) => void) | undefined;
        let onError: ((e: Error) => void) | undefined;
        useCheckMock.mockImplementation((_slug: string, opts: {
            onSuccess?: (res: { ok: boolean; error?: string; latency_ms?: number }) => void;
            onError?: (e: Error) => void;
        }) => {
            onSuccess = opts.onSuccess;
            onError = opts.onError;
            return mutationResult({});
        });
        renderWithClient(<ProviderDetailPage />);

        onSuccess?.({ ok: true, latency_ms: 88 });
        expect(toastSuccess).toHaveBeenCalledWith("Healthy (88ms)");
        onSuccess?.({ ok: true });
        expect(toastSuccess).toHaveBeenCalledWith("Healthy");
        onSuccess?.({ ok: false, error: "timeout" });
        expect(toastError).toHaveBeenCalledWith("Down: timeout");
        onSuccess?.({ ok: false });
        expect(toastError).toHaveBeenCalledWith("Down: unknown");
        onError?.(new Error("network blip"));
        expect(toastError).toHaveBeenCalledWith("Health check failed: network blip");
    });

    it("runs the delete mutation's onSuccess/onError callbacks, including the generic fallback message", () => {
        let onSuccess: (() => void) | undefined;
        let onError: ((e: Error) => void) | undefined;
        useModelDeleteMock.mockImplementation((opts: { onSuccess?: () => void; onError?: (e: Error) => void }) => {
            onSuccess = opts.onSuccess;
            onError = opts.onError;
            return mutationResult({});
        });
        renderWithClient(<ProviderDetailPage />);
        act(() => {
            onSuccess?.();
        });
        expect(toastSuccess).toHaveBeenCalledWith("Model deleted");
        onError?.(new Error("locked"));
        expect(toastError).toHaveBeenCalledWith("locked");
        onError?.(new Error(""));
        expect(toastError).toHaveBeenCalledWith("Delete failed");
    });
});
