import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ModelsSection } from "@/app/(dashboard)/settings/_sections/models";
import { defaultUserPreferences, type UserPreferencesDTO } from "@/lib/schemas/preferences";
import type { ModelDTO } from "@/lib/schemas/model";
import { makeQueryClient, mutationResult, queryResult, renderWithClient } from "./_helpers";
import { QueryClientProvider } from "@tanstack/react-query";

const useGetMock = vi.fn();
const useUpdateMock = vi.fn();
vi.mock("@/lib/api/preferences", () => ({
    preferences: {
        useGet: (...a: unknown[]) => useGetMock(...a),
        useUpdate: (...a: unknown[]) => useUpdateMock(...a),
    },
}));

const useModelListMock = vi.fn();
vi.mock("@/lib/api/models", () => ({ models: { useList: (...a: unknown[]) => useModelListMock(...a) } }));

const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastError(...a) } }));

vi.mock("@/components/ProviderIcon", () => ({
    ProviderIcon: ({ providerName }: { providerName: string }) => <span data-testid="provider-icon">{providerName}</span>,
}));

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

// Renders just the "Chat Model" field's ModelSelect in isolation by giving the
// summary model an empty value — avoids text collisions between the two
// side-by-side ModelSelect instances (both draw from the same model list).
function renderChatOnly() {
    useGetMock.mockReturnValue(
        queryResult<UserPreferencesDTO>({ data: { ...defaultUserPreferences, default_model: "gpt-4", default_summary_model: "" } })
    );
    const client = makeQueryClient();
    return render(
        <QueryClientProvider client={client}>
            <ModelsSection />
        </QueryClientProvider>
    );
}

describe("ModelsSection", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useGetMock.mockReturnValue(
            queryResult<UserPreferencesDTO>({ data: { ...defaultUserPreferences, default_model: "gpt-4", default_summary_model: "gpt-4-mini" } })
        );
        useUpdateMock.mockReturnValue(mutationResult({}));
        useModelListMock.mockReturnValue(
            queryResult<ModelDTO[]>({
                data: [
                    makeModel(),
                    makeModel({ id: "model-2", name: "gpt-4-mini", provider: "openai" }),
                    makeModel({ id: "model-3", name: "disabled-chat", enabled: false }),
                    makeModel({ id: "model-4", name: "text-embed", type: "embedding" }),
                ],
            })
        );
    });

    it("shows the current chat/summary model selections", () => {
        renderWithClient(<ModelsSection />);
        expect(screen.getByRole("button", { name: /gpt-4$/ })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /gpt-4-mini/ })).toBeInTheDocument();
    });

    it("shows a loading placeholder and disables both dropdowns while models load", () => {
        useGetMock.mockReturnValue(
            queryResult<UserPreferencesDTO>({ data: { ...defaultUserPreferences, default_model: "", default_summary_model: "" } })
        );
        useModelListMock.mockReturnValue(queryResult<ModelDTO[]>({ data: undefined, isLoading: true }));
        renderWithClient(<ModelsSection />);
        expect(screen.getAllByText("Loading...")).toHaveLength(2);
        for (const btn of screen.getAllByRole("button")) expect(btn).toBeDisabled();
    });

    it("only offers enabled chat-capability models in the dropdown (excludes disabled + non-chat)", async () => {
        const user = userEvent.setup();
        renderChatOnly();
        const chatButton = screen.getByRole("button", { name: /gpt-4$/ });
        await user.click(chatButton);

        const popover = chatButton.closest(".relative")!.querySelector(".absolute") as HTMLElement;
        expect(within(popover).getByText("gpt-4-mini")).toBeInTheDocument();
        expect(within(popover).queryByText("disabled-chat")).not.toBeInTheDocument();
        expect(within(popover).queryByText("text-embed")).not.toBeInTheDocument();
    });

    it("tolerates a chat model with no provider set (falls back to undefined, not null)", async () => {
        const user = userEvent.setup();
        useModelListMock.mockReturnValue(
            queryResult<ModelDTO[]>({
                data: [makeModel(), makeModel({ id: "model-5", name: "no-provider-model", provider: null })],
            })
        );
        renderChatOnly();
        const chatButton = screen.getByRole("button", { name: /gpt-4$/ });
        await user.click(chatButton);

        const popover = chatButton.closest(".relative")!.querySelector(".absolute") as HTMLElement;
        expect(within(popover).getByText("no-provider-model")).toBeInTheDocument();
    });

    it("selects a chat model and saves the preference", async () => {
        const user = userEvent.setup();
        const mutate = vi.fn();
        useUpdateMock.mockReturnValue(mutationResult({ mutate }));
        renderChatOnly();

        const chatButton = screen.getByRole("button", { name: /gpt-4$/ });
        await user.click(chatButton);
        const popover = chatButton.closest(".relative")!.querySelector(".absolute") as HTMLElement;
        await user.click(within(popover).getByText("gpt-4-mini"));
        expect(mutate).toHaveBeenCalledWith({ default_model: "gpt-4-mini" }, expect.anything());
    });

    it("selects a summary model independently of the chat model dropdown", async () => {
        const user = userEvent.setup();
        const mutate = vi.fn();
        useUpdateMock.mockReturnValue(mutationResult({ mutate }));
        renderWithClient(<ModelsSection />);

        const summaryButton = screen.getByRole("button", { name: /gpt-4-mini/ });
        await user.click(summaryButton);
        const popover = summaryButton.closest(".relative")!.querySelector(".absolute") as HTMLElement;
        await user.click(within(popover).getByText("gpt-4"));
        expect(mutate).toHaveBeenCalledWith({ default_summary_model: "gpt-4" }, expect.anything());
    });

    it("flags a stale/unavailable saved model that no longer exists in the option list", () => {
        useGetMock.mockReturnValue(
            queryResult<UserPreferencesDTO>({ data: { ...defaultUserPreferences, default_model: "long-deleted-model", default_summary_model: "" } })
        );
        renderWithClient(<ModelsSection />);
        expect(screen.getByText("(unavailable)")).toBeInTheDocument();
        expect(screen.getByTitle("long-deleted-model is no longer available — pick another")).toBeInTheDocument();
    });

    it("does not flag an empty selection as stale", () => {
        useGetMock.mockReturnValue(
            queryResult<UserPreferencesDTO>({ data: { ...defaultUserPreferences, default_model: "", default_summary_model: "" } })
        );
        renderWithClient(<ModelsSection />);
        expect(screen.queryByText("(unavailable)")).not.toBeInTheDocument();
        expect(screen.getAllByText("Select model")).toHaveLength(2);
    });

    it("filters the dropdown options via the search box", async () => {
        const user = userEvent.setup();
        renderChatOnly();
        const chatButton = screen.getByRole("button", { name: /gpt-4$/ });
        await user.click(chatButton);
        const popover = chatButton.closest(".relative")!.querySelector(".absolute") as HTMLElement;

        await user.type(within(popover).getByPlaceholderText("Search..."), "mini");
        expect(within(popover).getByText("gpt-4-mini")).toBeInTheDocument();
        expect(within(popover).queryByText("gpt-4", { selector: "span.truncate" })).not.toBeInTheDocument();
    });

    it("shows a 'No models' message when the search matches nothing", async () => {
        const user = userEvent.setup();
        renderChatOnly();
        const chatButton = screen.getByRole("button", { name: /gpt-4$/ });
        await user.click(chatButton);
        const popover = chatButton.closest(".relative")!.querySelector(".absolute") as HTMLElement;

        await user.type(within(popover).getByPlaceholderText("Search..."), "zzzznope");
        expect(within(popover).getByText("No models")).toBeInTheDocument();
    });

    it("closes the dropdown when clicking outside", async () => {
        const user = userEvent.setup();
        renderChatOnly();
        const chatButton = screen.getByRole("button", { name: /gpt-4$/ });
        await user.click(chatButton);
        expect(screen.getByPlaceholderText("Search...")).toBeInTheDocument();

        await user.click(document.body);
        expect(screen.queryByPlaceholderText("Search...")).not.toBeInTheDocument();
    });

    it("falls back to the default preferences shape when the server hasn't returned data yet", () => {
        useGetMock.mockReturnValue(queryResult<UserPreferencesDTO>({ data: undefined }));
        renderWithClient(<ModelsSection />);
        expect(screen.getAllByText("Select model")).toHaveLength(2);
    });

    it("toasts the save error when a model selection fails to persist", async () => {
        const user = userEvent.setup();
        let capturedOnError: ((e: Error) => void) | undefined;
        useUpdateMock.mockImplementation(() =>
            mutationResult({
                mutate: (_vars: unknown, opts?: { onError?: (e: Error) => void }) => {
                    capturedOnError = opts?.onError;
                },
            })
        );
        renderChatOnly();

        const chatButton = screen.getByRole("button", { name: /gpt-4$/ });
        await user.click(chatButton);
        const popover = chatButton.closest(".relative")!.querySelector(".absolute") as HTMLElement;
        await user.click(within(popover).getByText("gpt-4-mini"));

        expect(capturedOnError).toBeInstanceOf(Function);
        capturedOnError!(new Error("disk full"));
        expect(toastError).toHaveBeenCalledWith("disk full");
    });

    it("falls back to a generic message when the save error has no message", async () => {
        const user = userEvent.setup();
        let capturedOnError: ((e: Error) => void) | undefined;
        useUpdateMock.mockImplementation(() =>
            mutationResult({
                mutate: (_vars: unknown, opts?: { onError?: (e: Error) => void }) => {
                    capturedOnError = opts?.onError;
                },
            })
        );
        renderChatOnly();

        const chatButton = screen.getByRole("button", { name: /gpt-4$/ });
        await user.click(chatButton);
        const popover = chatButton.closest(".relative")!.querySelector(".absolute") as HTMLElement;
        await user.click(within(popover).getByText("gpt-4-mini"));

        expect(capturedOnError).toBeInstanceOf(Function);
        capturedOnError!(new Error(""));
        expect(toastError).toHaveBeenCalledWith("Failed to save");
    });
});
