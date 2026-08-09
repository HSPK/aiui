import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ProvidersPage from "@/app/(dashboard)/providers/page";
import type { ProviderDTO } from "@/lib/schemas/provider";
import type { ModelDTO } from "@/lib/schemas/model";
import { adminUser, makeRouter, mutationResult, normalUser, queryResult, renderWithClient } from "./_helpers";

const useRouterMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => useRouterMock() }));

const useAuthMock = vi.fn();
vi.mock("@/context/auth-context", () => ({ useAuth: () => useAuthMock() }));

const toastSuccess = vi.fn();
const toastError = vi.fn();
const toastInfo = vi.fn();
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a), info: (...a: unknown[]) => toastInfo(...a) } }));

const useProviderListMock = vi.fn();
const useReloadMock = vi.fn();
const useProviderDeleteMock = vi.fn();
const useCheckManyMock = vi.fn();
const providerCheckFn = vi.fn();
vi.mock("@/lib/api/providers", () => ({
    providers: {
        useList: (...a: unknown[]) => useProviderListMock(...a),
        useReload: (...a: unknown[]) => useReloadMock(...a),
        useDelete: (...a: unknown[]) => useProviderDeleteMock(...a),
        useCheckMany: (...a: unknown[]) => useCheckManyMock(...a),
        check: (...a: unknown[]) => providerCheckFn(...a),
    },
}));

const useModelListMock = vi.fn();
const useModelDeleteMock = vi.fn();
vi.mock("@/lib/api/models", () => ({
    models: {
        useList: (...a: unknown[]) => useModelListMock(...a),
        useDelete: (...a: unknown[]) => useModelDeleteMock(...a),
    },
}));

vi.mock("@/components/providers/provider-card", () => ({
    ProviderCard: ({
        provider,
        onClick,
        hoverActions,
    }: {
        provider: ProviderDTO;
        onClick?: () => void;
        hoverActions?: React.ReactNode;
    }) => (
        <div data-testid="provider-card" data-name={provider.name} onClick={onClick}>
            {provider.provider_name}
            {hoverActions}
        </div>
    ),
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
                <div key={m.id} data-testid="model-row" data-name={m.name}>
                    <span>{m.name}</span>
                    {onEdit && <button onClick={() => onEdit(m)}>edit-model-{m.name}</button>}
                    {onDelete && <button onClick={() => onDelete(m)}>delete-model-{m.name}</button>}
                </div>
            ))}
        </div>
    ),
}));

vi.mock("@/components/providers/provider-form-dialog", () => ({
    ProviderFormDialog: ({
        open,
        mode,
        provider,
        onOpenChange,
    }: {
        open: boolean;
        mode: string;
        provider?: ProviderDTO | null;
        onOpenChange: (open: boolean) => void;
    }) => (open ? (
        <div data-testid="provider-form-dialog" data-mode={mode}>
            {provider?.name ?? "new"}
            <button onClick={() => onOpenChange(false)}>close-provider-form</button>
        </div>
    ) : null),
}));

vi.mock("@/components/providers/model-form-dialog", () => ({
    ModelFormDialog: ({
        open,
        mode,
        model,
        onOpenChange,
    }: {
        open: boolean;
        mode: string;
        model?: ModelDTO | null;
        onOpenChange: (open: boolean) => void;
    }) => (open ? (
        <div data-testid="model-form-dialog" data-mode={mode}>
            {model?.name ?? "new"}
            <button onClick={() => onOpenChange(false)}>close-model-form</button>
        </div>
    ) : null),
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
        document_page: "",
        model_page: "",
        health_check_url: null,
        last_health_status: null,
        last_health_checked_at: null,
        last_health_error: null,
        is_local: false,
        enabled: true,
        n_models: 3,
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

describe("ProvidersPage", () => {
    let checkMutate: ReturnType<typeof vi.fn>;
    let isPendingId: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.clearAllMocks();
        useRouterMock.mockReturnValue(makeRouter());
        useAuthMock.mockReturnValue({ user: adminUser });
        useProviderListMock.mockReturnValue(
            queryResult<ProviderDTO[]>({ data: [makeProvider()] })
        );
        useModelListMock.mockReturnValue(queryResult<ModelDTO[]>({ data: [makeModel()] }));
        useReloadMock.mockReturnValue(mutationResult({}));
        useProviderDeleteMock.mockReturnValue(mutationResult({}));
        useModelDeleteMock.mockReturnValue(mutationResult({}));
        checkMutate = vi.fn();
        isPendingId = vi.fn().mockReturnValue(false);
        useCheckManyMock.mockReturnValue({
            mutate: checkMutate,
            mutateAsync: vi.fn(),
            isPendingId,
            anyPending: false,
            pendingCount: 0,
        });
    });

    it("renders the provider list with a count and lets an admin add a provider", async () => {
        const user = userEvent.setup();
        renderWithClient(<ProvidersPage />);
        expect(screen.getByText("1 providers")).toBeInTheDocument();
        expect(screen.getByTestId("provider-card")).toHaveTextContent("OpenAI");

        await user.click(screen.getByRole("button", { name: "Add provider" }));
        expect(screen.getByTestId("provider-form-dialog")).toHaveAttribute("data-mode", "create");
    });

    it("hides add/edit/delete actions for a non-admin", () => {
        useAuthMock.mockReturnValue({ user: normalUser });
        renderWithClient(<ProvidersPage />);
        expect(screen.queryByRole("button", { name: "Add provider" })).not.toBeInTheDocument();
        expect(screen.queryByTitle("Edit")).not.toBeInTheDocument();
        expect(screen.queryByTitle("Delete")).not.toBeInTheDocument();
        // Health re-check stays available to every viewer.
        expect(screen.getByTitle("Re-check health")).toBeInTheDocument();
    });

    it("shows a loading state while providers are loading", () => {
        useProviderListMock.mockReturnValue(queryResult<ProviderDTO[]>({ data: undefined, isLoading: true }));
        renderWithClient(<ProvidersPage />);
        expect(screen.getByText("Loading providers…")).toBeInTheDocument();
    });

    it("shows an empty state with an admin CTA when there are no providers", async () => {
        const user = userEvent.setup();
        useProviderListMock.mockReturnValue(queryResult<ProviderDTO[]>({ data: [] }));
        renderWithClient(<ProvidersPage />);
        expect(screen.getByText("No providers found.")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: /Add your first provider/ }));
        expect(screen.getByTestId("provider-form-dialog")).toHaveAttribute("data-mode", "create");
    });

    it("shows an empty state without the CTA for a non-admin", () => {
        useAuthMock.mockReturnValue({ user: normalUser });
        useProviderListMock.mockReturnValue(queryResult<ProviderDTO[]>({ data: [] }));
        renderWithClient(<ProvidersPage />);
        expect(screen.getByText("No providers found.")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /Add your first provider/ })).not.toBeInTheDocument();
    });

    it("filters the provider list by search text", async () => {
        const user = userEvent.setup();
        useProviderListMock.mockReturnValue(
            queryResult<ProviderDTO[]>({
                data: [makeProvider(), makeProvider({ id: "prov-2", name: "azure", provider_name: "Azure" })],
            })
        );
        renderWithClient(<ProvidersPage />);
        expect(screen.getAllByTestId("provider-card")).toHaveLength(2);
        await user.type(screen.getByPlaceholderText("Search..."), "azure");
        expect(screen.getAllByTestId("provider-card")).toHaveLength(1);
        expect(screen.getByTestId("provider-card")).toHaveTextContent("Azure");
    });

    it("sorts providers by name and by model count", async () => {
        const user = userEvent.setup();
        useProviderListMock.mockReturnValue(
            queryResult<ProviderDTO[]>({
                data: [
                    makeProvider({ id: "a", name: "zeta", provider_name: "Zeta", n_models: 1 }),
                    makeProvider({ id: "b", name: "alpha", provider_name: "Alpha", n_models: 9 }),
                ],
            })
        );
        renderWithClient(<ProvidersPage />);

        await user.click(screen.getByRole("combobox"));
        await user.click(screen.getByRole("option", { name: "Name" }));
        let cards = screen.getAllByTestId("provider-card");
        expect(cards.map((c) => c.dataset.name)).toEqual(["alpha", "zeta"]);

        await user.click(screen.getByRole("combobox"));
        await user.click(screen.getByRole("option", { name: "Total Models" }));
        cards = screen.getAllByTestId("provider-card");
        expect(cards.map((c) => c.dataset.name)).toEqual(["alpha", "zeta"]);
    });

    it("only fetches models while the models tab is active, and sorts them", async () => {
        const user = userEvent.setup();
        useModelListMock.mockReturnValue(
            queryResult<ModelDTO[]>({
                data: [
                    makeModel({ id: "m1", name: "zeta-model", type: "embedding", provider: "zprov", context_window: 1000 }),
                    makeModel({ id: "m2", name: "alpha-model", type: "chat", provider: "aprov", context_window: 9000 }),
                ],
            })
        );
        renderWithClient(<ProvidersPage />);
        expect(useModelListMock.mock.calls[0]?.[1]).toMatchObject({ enabled: false });

        await user.click(screen.getByRole("tab", { name: "Models" }));
        expect(useModelListMock.mock.calls.at(-1)?.[1]).toMatchObject({ enabled: true });
        expect(screen.getByText("2 models")).toBeInTheDocument();

        await user.click(screen.getByRole("combobox"));
        await user.click(screen.getByRole("option", { name: "Name" }));
        let rows = screen.getAllByTestId("model-row");
        expect(rows.map((r) => r.dataset.name)).toEqual(["alpha-model", "zeta-model"]);

        await user.click(screen.getByRole("combobox"));
        await user.click(screen.getByRole("option", { name: "Type" }));
        rows = screen.getAllByTestId("model-row");
        expect(rows.map((r) => r.dataset.name)).toEqual(["alpha-model", "zeta-model"]); // chat < embedding

        await user.click(screen.getByRole("combobox"));
        await user.click(screen.getByRole("option", { name: "Provider" }));
        rows = screen.getAllByTestId("model-row");
        expect(rows.map((r) => r.dataset.name)).toEqual(["alpha-model", "zeta-model"]); // aprov < zprov

        await user.click(screen.getByRole("combobox"));
        await user.click(screen.getByRole("option", { name: "Context Window" }));
        rows = screen.getAllByTestId("model-row");
        expect(rows.map((r) => r.dataset.name)).toEqual(["alpha-model", "zeta-model"]); // 9000 > 1000
    });

    it("shows a loading overlay while models are loading", async () => {
        const user = userEvent.setup();
        useModelListMock.mockReturnValue(queryResult<ModelDTO[]>({ data: undefined, isLoading: true }));
        renderWithClient(<ProvidersPage />);
        await user.click(screen.getByRole("tab", { name: "Models" }));
        expect(screen.getByText("Loading models…")).toBeInTheDocument();
    });

    it("lets an admin add a model, and maps discovered rows to 'create' mode on edit", async () => {
        const user = userEvent.setup();
        useModelListMock.mockReturnValue(
            queryResult<ModelDTO[]>({ data: [makeModel({ is_discovered: true })] })
        );
        renderWithClient(<ProvidersPage />);
        await user.click(screen.getByRole("tab", { name: "Models" }));

        await user.click(screen.getByRole("button", { name: "Add model" }));
        expect(screen.getByTestId("model-form-dialog")).toHaveAttribute("data-mode", "create");
    });

    it("opens the model edit dialog in 'edit' mode for a non-discovered model", async () => {
        const user = userEvent.setup();
        renderWithClient(<ProvidersPage />);
        await user.click(screen.getByRole("tab", { name: "Models" }));
        await user.click(screen.getByText("edit-model-gpt-4"));
        expect(screen.getByTestId("model-form-dialog")).toHaveAttribute("data-mode", "edit");
    });

    it("maps a discovered model to 'create' mode when its edit affordance is clicked directly", async () => {
        const user = userEvent.setup();
        useModelListMock.mockReturnValue(
            queryResult<ModelDTO[]>({ data: [makeModel({ name: "disc-model", is_discovered: true })] })
        );
        renderWithClient(<ProvidersPage />);
        await user.click(screen.getByRole("tab", { name: "Models" }));
        await user.click(screen.getByText("edit-model-disc-model"));
        expect(screen.getByTestId("model-form-dialog")).toHaveAttribute("data-mode", "create");
    });

    it("hides the add-model button and edit/delete affordances for a non-admin", async () => {
        const user = userEvent.setup();
        useAuthMock.mockReturnValue({ user: normalUser });
        renderWithClient(<ProvidersPage />);
        await user.click(screen.getByRole("tab", { name: "Models" }));
        expect(screen.queryByRole("button", { name: "Add model" })).not.toBeInTheDocument();
        expect(screen.queryByText("edit-model-gpt-4")).not.toBeInTheDocument();
        expect(screen.queryByText("delete-model-gpt-4")).not.toBeInTheDocument();
    });

    it("re-checks a single provider's health from the card's hover action", async () => {
        const user = userEvent.setup();
        renderWithClient(<ProvidersPage />);
        await user.click(screen.getByTitle("Re-check health"));
        expect(checkMutate).toHaveBeenCalledWith("prov-1");
    });

    it("opens the edit dialog for a provider and deletes it via the confirm dialog", async () => {
        const user = userEvent.setup();
        const mutate = vi.fn();
        useProviderDeleteMock.mockReturnValue(mutationResult({ mutate }));
        renderWithClient(<ProvidersPage />);

        await user.click(screen.getByTitle("Edit"));
        expect(screen.getByTestId("provider-form-dialog")).toHaveAttribute("data-mode", "edit");

        await user.click(screen.getByTitle("Delete"));
        expect(screen.getByText("Delete provider?")).toBeInTheDocument();
        const dialog = screen.getByRole("alertdialog");
        expect(within(dialog).getByText("openai", { selector: "b" })).toBeInTheDocument();
        await user.click(within(dialog).getByRole("button", { name: "Delete" }));
        expect(mutate).toHaveBeenCalledWith("prov-1");
    });

    it("deletes a model via the confirm dialog", async () => {
        const user = userEvent.setup();
        const mutate = vi.fn();
        useModelDeleteMock.mockReturnValue(mutationResult({ mutate }));
        renderWithClient(<ProvidersPage />);
        await user.click(screen.getByRole("tab", { name: "Models" }));

        await user.click(screen.getByText("delete-model-gpt-4"));
        expect(screen.getByText("Delete model?")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Delete" }));
        expect(mutate).toHaveBeenCalledWith("model-1");
    });

    it("reloads providers and models via the refresh button", async () => {
        const user = userEvent.setup();
        const mutate = vi.fn();
        useReloadMock.mockReturnValue(mutationResult({ mutate }));
        renderWithClient(<ProvidersPage />);
        // Three RefreshCcw icons render on this page (per-card re-check, the
        // "Check all" button, and the plain reload button) — the plain
        // reload button is the only one of the three with no `title` attr
        // (its label lives in a Radix Tooltip instead).
        const icons = Array.from(document.querySelectorAll(".lucide-refresh-ccw"));
        const reloadButton = icons.map((icon) => icon.closest("button")!).find((btn) => !btn.title);
        await user.click(reloadButton!);
        expect(mutate).toHaveBeenCalled();
    });

    it("shows an info toast when checking all providers but none have a health_check_url", async () => {
        const user = userEvent.setup();
        renderWithClient(<ProvidersPage />);
        await user.click(screen.getByRole("button", { name: "Check all" }));
        expect(toastInfo).toHaveBeenCalledWith("No providers with a configured health_check_url.");
        expect(providerCheckFn).not.toHaveBeenCalled();
    });

    it("bulk-checks every enabled provider with a health_check_url and reports success", async () => {
        const user = userEvent.setup();
        useProviderListMock.mockReturnValue(
            queryResult<ProviderDTO[]>({
                data: [
                    makeProvider({ id: "a", health_check_url: "https://a/health" }),
                    makeProvider({ id: "b", name: "azure", health_check_url: "https://b/health" }),
                    makeProvider({ id: "c", name: "disabled-one", enabled: false, health_check_url: "https://c/health" }),
                ],
            })
        );
        providerCheckFn.mockResolvedValue({ ok: true });
        renderWithClient(<ProvidersPage />);
        await user.click(screen.getByRole("button", { name: "Check all" }));
        expect(providerCheckFn).toHaveBeenCalledTimes(2);
        expect(providerCheckFn).toHaveBeenCalledWith("a");
        expect(providerCheckFn).toHaveBeenCalledWith("b");
        expect(toastSuccess).toHaveBeenCalledWith("Checked 2 providers — all healthy.");
    });

    it("reports exactly one healthy provider with singular grammar", async () => {
        const user = userEvent.setup();
        useProviderListMock.mockReturnValue(
            queryResult<ProviderDTO[]>({
                data: [makeProvider({ id: "solo", health_check_url: "https://solo/health" })],
            })
        );
        providerCheckFn.mockResolvedValueOnce({ ok: true });
        renderWithClient(<ProvidersPage />);
        await user.click(screen.getByRole("button", { name: "Check all" }));
        expect(toastSuccess).toHaveBeenCalledWith("Checked 1 provider — all healthy.");
    });

    it("bulk-checks and reports partial failures (including thrown errors)", async () => {
        const user = userEvent.setup();
        useProviderListMock.mockReturnValue(
            queryResult<ProviderDTO[]>({
                data: [
                    makeProvider({ id: "a", health_check_url: "https://a/health" }),
                    makeProvider({ id: "b", name: "azure", health_check_url: "https://b/health" }),
                ],
            })
        );
        providerCheckFn.mockResolvedValueOnce({ ok: false, error: "timeout" }).mockRejectedValueOnce(new Error("network"));
        renderWithClient(<ProvidersPage />);
        await user.click(screen.getByRole("button", { name: "Check all" }));
        expect(toastError).toHaveBeenCalledWith("Checked 2 providers — 2 failed.");
    });

    it("matches providers only by name when proxy is an empty string, without throwing", async () => {
        const user = userEvent.setup();
        useProviderListMock.mockReturnValue(
            queryResult<ProviderDTO[]>({
                data: [
                    makeProvider({ id: "a", name: "openai", provider_name: "OpenAI", proxy: "" }),
                    makeProvider({ id: "b", name: "azure", provider_name: "Azure", proxy: "https://azure-proxy.example.com" }),
                ],
            })
        );
        renderWithClient(<ProvidersPage />);
        await user.type(screen.getByPlaceholderText("Search..."), "azure-proxy");
        // Only "azure" matches, via its proxy URL. "openai" (empty proxy)
        // must fall back to "" safely rather than matching or throwing.
        expect(screen.getAllByTestId("provider-card")).toHaveLength(1);
        expect(screen.getByTestId("provider-card")).toHaveTextContent("Azure");
    });

    it("treats a missing n_models as zero when sorting providers by model count", async () => {
        const user = userEvent.setup();
        useProviderListMock.mockReturnValue(
            queryResult<ProviderDTO[]>({
                data: [
                    makeProvider({ id: "a", name: "no-count-a", provider_name: "NoCountA", n_models: undefined }),
                    makeProvider({ id: "b", name: "no-count-b", provider_name: "NoCountB", n_models: undefined }),
                    makeProvider({ id: "c", name: "has-count", provider_name: "HasCount", n_models: 5 }),
                ],
            })
        );
        renderWithClient(<ProvidersPage />);
        await user.click(screen.getByRole("combobox"));
        await user.click(screen.getByRole("option", { name: "Total Models" }));
        const cards = screen.getAllByTestId("provider-card");
        // Both zero-valued rows tie and keep their relative input order
        // (stable sort); the real count sorts first.
        expect(cards.map((c) => c.dataset.name)).toEqual(["has-count", "no-count-a", "no-count-b"]);
    });

    it("falls back to the provider name for the list key when id is empty", () => {
        useProviderListMock.mockReturnValue(
            queryResult<ProviderDTO[]>({ data: [makeProvider({ id: "", name: "keyless" })] })
        );
        renderWithClient(<ProvidersPage />);
        expect(screen.getByTestId("provider-card")).toHaveAttribute("data-name", "keyless");
    });

    it("navigates to the provider detail page when a card is clicked", async () => {
        const user = userEvent.setup();
        const push = vi.fn();
        useRouterMock.mockReturnValue(makeRouter({ push }));
        renderWithClient(<ProvidersPage />);
        await user.click(screen.getByTestId("provider-card"));
        expect(push).toHaveBeenCalledWith("/providers/openai");
    });

    it("shows the spin animation while a provider's own health check is pending", () => {
        isPendingId.mockReturnValue(true);
        renderWithClient(<ProvidersPage />);
        const button = screen.getByTitle("Re-check health");
        expect(button).toBeDisabled();
        expect(button.querySelector(".lucide-refresh-ccw")).toHaveClass("animate-spin");
    });

    it("matches models only by name when provider is missing, without throwing", async () => {
        const user = userEvent.setup();
        useModelListMock.mockReturnValue(
            queryResult<ModelDTO[]>({
                data: [
                    makeModel({ id: "m1", name: "solo", model_id: "solo-id", provider: null }),
                    makeModel({ id: "m2", name: "other", model_id: "other-id", provider: "acme" }),
                ],
            })
        );
        renderWithClient(<ProvidersPage />);
        await user.click(screen.getByRole("tab", { name: "Models" }));
        await user.type(screen.getByPlaceholderText("Search..."), "acme");
        // Only "other" matches via its provider field. "solo" (provider:
        // null) must fall back to "" safely rather than matching or
        // throwing.
        const rows = screen.getAllByTestId("model-row");
        expect(rows).toHaveLength(1);
        expect(rows[0]).toHaveAttribute("data-name", "other");
    });

    it("treats a missing provider as an empty string when sorting models by provider", async () => {
        const user = userEvent.setup();
        useModelListMock.mockReturnValue(
            queryResult<ModelDTO[]>({
                data: [
                    makeModel({ id: "m1", name: "no-provider-a", provider: null }),
                    makeModel({ id: "m2", name: "no-provider-b", provider: null }),
                    makeModel({ id: "m3", name: "has-provider", provider: "acme" }),
                ],
            })
        );
        renderWithClient(<ProvidersPage />);
        await user.click(screen.getByRole("tab", { name: "Models" }));
        await user.click(screen.getByRole("combobox"));
        await user.click(screen.getByRole("option", { name: "Provider" }));
        const rows = screen.getAllByTestId("model-row");
        // Both null-provider rows tie at "" and keep their relative input
        // order (stable sort); "acme" sorts after them.
        expect(rows.map((r) => r.dataset.name)).toEqual(["no-provider-a", "no-provider-b", "has-provider"]);
    });

    it("treats a missing context_window as zero when sorting models by context", async () => {
        const user = userEvent.setup();
        useModelListMock.mockReturnValue(
            queryResult<ModelDTO[]>({
                data: [
                    makeModel({ id: "m1", name: "no-context-a", context_window: null }),
                    makeModel({ id: "m2", name: "no-context-b", context_window: null }),
                    makeModel({ id: "m3", name: "has-context", context_window: 4096 }),
                ],
            })
        );
        renderWithClient(<ProvidersPage />);
        await user.click(screen.getByRole("tab", { name: "Models" }));
        await user.click(screen.getByRole("combobox"));
        await user.click(screen.getByRole("option", { name: "Context Window" }));
        const rows = screen.getAllByTestId("model-row");
        expect(rows.map((r) => r.dataset.name)).toEqual(["has-context", "no-context-a", "no-context-b"]);
    });

    it("runs the reload mutation's onSuccess and onError callbacks", () => {
        let onSuccess: (() => void) | undefined;
        let onError: ((e: Error) => void) | undefined;
        useReloadMock.mockImplementation((opts: { onSuccess?: () => void; onError?: (e: Error) => void }) => {
            onSuccess = opts.onSuccess;
            onError = opts.onError;
            return mutationResult({});
        });
        renderWithClient(<ProvidersPage />);
        onSuccess?.();
        expect(toastSuccess).toHaveBeenCalledWith("Refreshed");
        onError?.(new Error("upstream down"));
        expect(toastError).toHaveBeenCalledWith("Refresh failed: upstream down");
    });

    it("runs the delete-provider mutation's onSuccess/onError callbacks, including the generic fallback message", () => {
        let onSuccess: (() => void) | undefined;
        let onError: ((e: Error) => void) | undefined;
        useProviderDeleteMock.mockImplementation((opts: { onSuccess?: () => void; onError?: (e: Error) => void }) => {
            onSuccess = opts.onSuccess;
            onError = opts.onError;
            return mutationResult({});
        });
        renderWithClient(<ProvidersPage />);
        act(() => {
            onSuccess?.();
        });
        expect(toastSuccess).toHaveBeenCalledWith("Provider deleted");
        onError?.(new Error("locked"));
        expect(toastError).toHaveBeenCalledWith("locked");
        onError?.(new Error(""));
        expect(toastError).toHaveBeenCalledWith("Delete failed");
    });

    it("runs the delete-model mutation's onSuccess/onError callbacks, including the generic fallback message", () => {
        let onSuccess: (() => void) | undefined;
        let onError: ((e: Error) => void) | undefined;
        useModelDeleteMock.mockImplementation((opts: { onSuccess?: () => void; onError?: (e: Error) => void }) => {
            onSuccess = opts.onSuccess;
            onError = opts.onError;
            return mutationResult({});
        });
        renderWithClient(<ProvidersPage />);
        act(() => {
            onSuccess?.();
        });
        expect(toastSuccess).toHaveBeenCalledWith("Model deleted");
        onError?.(new Error("locked"));
        expect(toastError).toHaveBeenCalledWith("locked");
        onError?.(new Error(""));
        expect(toastError).toHaveBeenCalledWith("Delete failed");
    });

    it("runs the per-provider check mutation's onSuccess/onError callbacks across ok/fail/latency/label permutations", () => {
        let onSuccess: ((id: string, res: { ok: boolean; error?: string; latency_ms?: number | null }) => void) | undefined;
        let onError: ((id: string, e: Error) => void) | undefined;
        useProviderListMock.mockReturnValue(
            queryResult<ProviderDTO[]>({ data: [makeProvider({ id: "prov-1", provider_name: "OpenAI" })] })
        );
        useCheckManyMock.mockImplementation((opts: {
            onSuccess?: (id: string, res: { ok: boolean; error?: string; latency_ms?: number | null }) => void;
            onError?: (id: string, e: Error) => void;
        }) => {
            onSuccess = opts.onSuccess;
            onError = opts.onError;
            return { mutate: vi.fn(), mutateAsync: vi.fn(), isPendingId: vi.fn().mockReturnValue(false), anyPending: false, pendingCount: 0 };
        });
        renderWithClient(<ProvidersPage />);

        // ok + latency present + label found
        onSuccess?.("prov-1", { ok: true, latency_ms: 42 });
        expect(toastSuccess).toHaveBeenCalledWith("OpenAI: healthy (42ms)");
        // ok + latency absent
        onSuccess?.("prov-1", { ok: true, latency_ms: null });
        expect(toastSuccess).toHaveBeenCalledWith("OpenAI: healthy");
        // not ok + error present
        onSuccess?.("prov-1", { ok: false, error: "timeout" });
        expect(toastError).toHaveBeenCalledWith("OpenAI: timeout");
        // not ok + error absent + unknown id (label fallback)
        onSuccess?.("missing-id", { ok: false });
        expect(toastError).toHaveBeenCalledWith("provider: down");
        // onError, label found + message present
        onError?.("prov-1", new Error("boom"));
        expect(toastError).toHaveBeenCalledWith("OpenAI: boom");
        // onError, label fallback + message fallback
        onError?.("missing-id", new Error(""));
        expect(toastError).toHaveBeenCalledWith("provider: check failed");
    });

    it("closes the provider form dialog via its onOpenChange", async () => {
        const user = userEvent.setup();
        renderWithClient(<ProvidersPage />);
        await user.click(screen.getByRole("button", { name: "Add provider" }));
        expect(screen.getByTestId("provider-form-dialog")).toBeInTheDocument();
        await user.click(screen.getByText("close-provider-form"));
        expect(screen.queryByTestId("provider-form-dialog")).not.toBeInTheDocument();
    });

    it("closes the model form dialog via its onOpenChange", async () => {
        const user = userEvent.setup();
        renderWithClient(<ProvidersPage />);
        await user.click(screen.getByRole("tab", { name: "Models" }));
        await user.click(screen.getByRole("button", { name: "Add model" }));
        expect(screen.getByTestId("model-form-dialog")).toBeInTheDocument();
        await user.click(screen.getByText("close-model-form"));
        expect(screen.queryByTestId("model-form-dialog")).not.toBeInTheDocument();
    });

    it("cancels the provider delete confirm dialog without deleting", async () => {
        const user = userEvent.setup();
        const mutate = vi.fn();
        useProviderDeleteMock.mockReturnValue(mutationResult({ mutate }));
        renderWithClient(<ProvidersPage />);
        await user.click(screen.getByTitle("Delete"));
        expect(screen.getByRole("alertdialog")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Cancel" }));
        expect(mutate).not.toHaveBeenCalled();
        expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });

    it("cancels the model delete confirm dialog without deleting", async () => {
        const user = userEvent.setup();
        const mutate = vi.fn();
        useModelDeleteMock.mockReturnValue(mutationResult({ mutate }));
        renderWithClient(<ProvidersPage />);
        await user.click(screen.getByRole("tab", { name: "Models" }));
        await user.click(screen.getByText("delete-model-gpt-4"));
        expect(screen.getByRole("alertdialog")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Cancel" }));
        expect(mutate).not.toHaveBeenCalled();
        expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
});
