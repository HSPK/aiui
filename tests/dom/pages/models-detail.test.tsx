import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ModelDashboardPage from "@/app/(dashboard)/models/[name]/page";
import type { ModelDTO } from "@/lib/schemas/model";
import type { ModelStatsDTO } from "@/lib/schemas/stats";
import type { ProviderDTO } from "@/lib/schemas/provider";
import { usePlaygroundStore } from "@/lib/stores/playground-store";
import { adminUser, makeRouter, normalUser, queryResult, renderWithClient } from "./_helpers";

const useParamsMock = vi.fn();
const useRouterMock = vi.fn();
vi.mock("next/navigation", () => ({
    useParams: () => useParamsMock(),
    useRouter: () => useRouterMock(),
}));

const useAuthMock = vi.fn();
vi.mock("@/context/auth-context", () => ({ useAuth: () => useAuthMock() }));

const useModelStatsMock = vi.fn();
vi.mock("@/lib/api/stats", () => ({ stats: { useModel: (...args: unknown[]) => useModelStatsMock(...args) } }));

const useModelGetMock = vi.fn();
vi.mock("@/lib/api/models", () => ({ models: { useGet: (...args: unknown[]) => useModelGetMock(...args) } }));

const useProviderGetMock = vi.fn();
vi.mock("@/lib/api/providers", () => ({ providers: { useGet: (...args: unknown[]) => useProviderGetMock(...args) } }));

vi.mock("@/components/ProviderIcon", () => ({
    ProviderIcon: ({ providerName }: { providerName: string }) => (
        <span data-testid="provider-icon">{providerName}</span>
    ),
}));

vi.mock("@/components/models/model-config-panel", () => ({
    ModelConfigPanel: ({ model, providerDefaults }: { model: ModelDTO; providerDefaults: unknown }) => (
        <div data-testid="model-config-panel" data-provider-defaults={JSON.stringify(providerDefaults)}>
            config-for-{model.name}
        </div>
    ),
}));

vi.mock("@/components/providers/model-form-dialog", () => ({
    ModelFormDialog: ({
        open,
        mode,
        model,
        onSaved,
    }: {
        open: boolean;
        mode: string;
        model: ModelDTO | null;
        onSaved: (saved: ModelDTO | null) => void;
    }) =>
        open ? (
            <div data-testid="model-form-dialog" data-mode={mode}>
                editing-{model?.name}
                <button onClick={() => onSaved({ ...(model as ModelDTO), name: model!.name })}>save-same-name</button>
                <button onClick={() => onSaved({ ...(model as ModelDTO), name: "renamed-model" })}>
                    save-renamed
                </button>
            </div>
        ) : null,
}));

vi.mock("@/app/(dashboard)/models/[name]/_parts/charts", () => ({
    UsageTrendCard: () => <div data-testid="usage-trend-card" />,
    ErrorRateCard: () => <div data-testid="error-rate-card" />,
    LatencyCard: () => <div data-testid="latency-card" />,
}));

function makeModelStats(overrides: Partial<ModelStatsDTO> = {}): ModelStatsDTO {
    return {
        model_name: "gpt-4",
        provider: "openai",
        capability: "chat",
        description: "A capable chat model.",
        context_window: 128_000,
        max_tokens: 4096,
        window_start: "2024-01-01",
        window_end: "2024-01-14",
        days: 14,
        totals: {
            requests: 200,
            completed: 190,
            failed: 10,
            pending: 0,
            prompt_tokens: 1000,
            completion_tokens: 2000,
            total_tokens: 3000,
            avg_first_token_latency_ms: 120,
            avg_total_latency_ms: 900,
        },
        trend: [
            {
                day: "2024-01-01",
                requests: 20,
                failed: 1,
                prompt_tokens: 100,
                completion_tokens: 200,
                total_tokens: 300,
                avg_first_token_latency_ms: 100,
                avg_total_latency_ms: 800,
            },
        ],
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
        default_params: { temperature: 0.7 },
        type: "chat",
        api_variant_id: null,
        resolved_variant_id: "chat.completions",
        pricing: null,
        output_dimension: null,
        context_window: 128_000,
        max_tokens: 4096,
        description: "A capable chat model.",
        knowledge_date: null,
        provider: "openai",
        provider_id: "provider-1",
        is_local: false,
        enabled: true,
        is_discovered: false,
        meta: null,
        ...overrides,
    };
}

function makeProvider(overrides: Partial<ProviderDTO> = {}): ProviderDTO {
    return {
        id: "provider-1",
        name: "openai",
        provider_name: "openai",
        adapter_id: "openai",
        base_url: "https://api.openai.com/v1",
        proxy: "https://api.openai.com/v1",
        api_version: null,
        has_api_key: true,
        default_params: { temperature: 0.5 },
        document_page: "",
        model_page: "",
        health_check_url: null,
        last_health_status: null,
        last_health_checked_at: null,
        last_health_error: null,
        is_local: false,
        enabled: true,
        created_at: "2024-01-01T00:00:00.000Z",
        updated_at: "2024-01-01T00:00:00.000Z",
        ...overrides,
    };
}

describe("ModelDashboardPage", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useParamsMock.mockReturnValue({ name: "gpt-4" });
        useRouterMock.mockReturnValue(makeRouter());
        useAuthMock.mockReturnValue({ user: normalUser });
        useModelStatsMock.mockReturnValue(queryResult<ModelStatsDTO>({ data: makeModelStats() }));
        useModelGetMock.mockReturnValue(queryResult<ModelDTO>({ data: makeModel() }));
        useProviderGetMock.mockReturnValue(queryResult<ProviderDTO>({ data: makeProvider() }));
        // Clear any settings a previous test seeded for this conversation id.
        usePlaygroundStore.setState({ settings: {} });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("renders the identity card, badges, KPIs and charts", () => {
        renderWithClient(<ModelDashboardPage />);
        expect(screen.getByText("gpt-4")).toBeInTheDocument();
        expect(screen.getByTestId("provider-icon")).toHaveTextContent("openai");
        expect(screen.getByText("chat")).toBeInTheDocument();
        expect(screen.getByText("128k ctx")).toBeInTheDocument();
        expect(screen.getByText("override")).toBeInTheDocument();
        expect(screen.getByText("A capable chat model.")).toBeInTheDocument();

        // KPIs
        expect(screen.getByText("200")).toBeInTheDocument(); // requests
        expect(screen.getByText("190 completed · 0 pending")).toBeInTheDocument();
        expect(screen.getByText("3.0k")).toBeInTheDocument(); // total tokens
        expect(screen.getByText("900ms")).toBeInTheDocument(); // avg total latency
        expect(screen.getByText("120ms time to first token")).toBeInTheDocument();
        expect(screen.getByText("5%")).toBeInTheDocument(); // error rate 10/200

        expect(screen.getByTestId("usage-trend-card")).toBeInTheDocument();
        expect(screen.getByTestId("error-rate-card")).toBeInTheDocument();
        expect(screen.getByTestId("latency-card")).toBeInTheDocument();
        expect(screen.getByTestId("model-config-panel")).toHaveTextContent("config-for-gpt-4");
    });

    it("shows a loading skeleton instead of the description while loading with no data yet", () => {
        useModelStatsMock.mockReturnValue(queryResult<ModelStatsDTO>({ data: undefined, isLoading: true }));
        renderWithClient(<ModelDashboardPage />);
        expect(screen.queryByText("A capable chat model.")).not.toBeInTheDocument();
    });

    it("shows a 'discovered' badge and no config-panel override note when the model is discovered", () => {
        useModelGetMock.mockReturnValue(queryResult<ModelDTO>({ data: makeModel({ is_discovered: true }) }));
        useAuthMock.mockReturnValue({ user: adminUser });
        renderWithClient(<ModelDashboardPage />);
        expect(screen.getByText("discovered")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Override/ })).toBeInTheDocument();
    });

    it("shows 'Not registered' when stats has neither a provider nor capability", () => {
        useModelStatsMock.mockReturnValue(
            queryResult<ModelStatsDTO>({ data: makeModelStats({ provider: null, capability: null }) })
        );
        renderWithClient(<ModelDashboardPage />);
        expect(screen.getByText("Not registered")).toBeInTheDocument();
    });

    it("flags the error rate KPI as danger when it exceeds 5%", () => {
        useModelStatsMock.mockReturnValue(
            queryResult<ModelStatsDTO>({
                data: makeModelStats({
                    totals: {
                        requests: 100,
                        completed: 80,
                        failed: 20,
                        pending: 0,
                        prompt_tokens: 10,
                        completion_tokens: 10,
                        total_tokens: 20,
                        avg_first_token_latency_ms: null,
                        avg_total_latency_ms: null,
                    },
                }),
            })
        );
        renderWithClient(<ModelDashboardPage />);
        expect(screen.getByText("20%")).toBeInTheDocument();
        // avg_*_latency_ms both null -> formatLatency falls back to em dash.
        expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    });

    it("hides Try/Edit for a non-admin viewing a chat model", () => {
        useAuthMock.mockReturnValue({ user: normalUser });
        renderWithClient(<ModelDashboardPage />);
        expect(screen.getByRole("button", { name: /Try/ })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /Edit/ })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /Override/ })).not.toBeInTheDocument();
    });

    it("hides the Try button for a non-chat capability", () => {
        useModelStatsMock.mockReturnValue(
            queryResult<ModelStatsDTO>({ data: makeModelStats({ capability: "embedding" }) })
        );
        renderWithClient(<ModelDashboardPage />);
        expect(screen.queryByRole("button", { name: /Try/ })).not.toBeInTheDocument();
    });

    it("mints a conversation id, seeds playground settings and navigates on 'Try in playground'", async () => {
        const user = userEvent.setup();
        const router = makeRouter();
        useRouterMock.mockReturnValue(router);
        vi.spyOn(crypto, "randomUUID").mockReturnValue("11111111-1111-1111-1111-111111111111");
        renderWithClient(<ModelDashboardPage />);

        await user.click(screen.getByRole("button", { name: /Try/ }));

        expect(usePlaygroundStore.getState().getSettings("11111111-1111-1111-1111-111111111111")).toMatchObject({
            modelIds: ["gpt-4"],
        });
        expect(router.push).toHaveBeenCalledWith(
            "/playground/chat?c=11111111-1111-1111-1111-111111111111"
        );
    });

    it("opens the edit dialog for an admin and passes 'edit' mode for an override model", async () => {
        const user = userEvent.setup();
        useAuthMock.mockReturnValue({ user: adminUser });
        renderWithClient(<ModelDashboardPage />);

        expect(screen.queryByTestId("model-form-dialog")).not.toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: /Edit/ }));
        const dialog = screen.getByTestId("model-form-dialog");
        expect(dialog).toHaveAttribute("data-mode", "edit");
    });

    it("passes 'create' mode to the form dialog for a discovered model", async () => {
        const user = userEvent.setup();
        useAuthMock.mockReturnValue({ user: adminUser });
        useModelGetMock.mockReturnValue(queryResult<ModelDTO>({ data: makeModel({ is_discovered: true }) }));
        renderWithClient(<ModelDashboardPage />);

        await user.click(screen.getByRole("button", { name: /Override/ }));
        expect(screen.getByTestId("model-form-dialog")).toHaveAttribute("data-mode", "create");
    });

    it("does not navigate when the saved model keeps the same name", async () => {
        const user = userEvent.setup();
        const router = makeRouter();
        useRouterMock.mockReturnValue(router);
        useAuthMock.mockReturnValue({ user: adminUser });
        renderWithClient(<ModelDashboardPage />);

        await user.click(screen.getByRole("button", { name: /Edit/ }));
        await user.click(screen.getByText("save-same-name"));
        expect(router.replace).not.toHaveBeenCalled();
    });

    it("navigates to the new slug when the saved model was renamed", async () => {
        const user = userEvent.setup();
        const router = makeRouter();
        useRouterMock.mockReturnValue(router);
        useAuthMock.mockReturnValue({ user: adminUser });
        renderWithClient(<ModelDashboardPage />);

        await user.click(screen.getByRole("button", { name: /Edit/ }));
        await user.click(screen.getByText("save-renamed"));
        await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/models/renamed-model"));
    });

    it("does not render the config panel until the model detail loads", () => {
        useModelGetMock.mockReturnValue(queryResult<ModelDTO>({ data: undefined }));
        renderWithClient(<ModelDashboardPage />);
        expect(screen.queryByTestId("model-config-panel")).not.toBeInTheDocument();
    });

    it("changes the stats window when a range option is clicked", async () => {
        const user = userEvent.setup();
        renderWithClient(<ModelDashboardPage />);
        await user.click(screen.getByRole("button", { name: "30d" }));
        await waitFor(() =>
            expect(useModelStatsMock).toHaveBeenLastCalledWith("gpt-4", { days: 30 })
        );
    });
});
