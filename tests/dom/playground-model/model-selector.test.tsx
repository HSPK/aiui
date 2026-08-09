// Tests for components/playground/model-selector.tsx (ConnectedModelSelector).
//
// The dropdown is a hand-rolled portal (not Radix), so it's driven with
// plain userEvent clicks + document.body queries (portal content renders
// as a sibling of the RTL container, both under document.body).
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";

import { renderWithClient, resetPlaygroundStores } from "./_render";
import { makeQuery } from "./_mocks";
import {
    chatModelClaude,
    chatModelDisabled,
    chatModelGpt35,
    chatModelGpt4o,
    embeddingModel,
    makePreferences,
} from "./_fixtures";

vi.mock("@/lib/api/models", () => ({
    models: { useList: vi.fn() },
}));
vi.mock("@/lib/api/preferences", () => ({
    preferences: { useGet: vi.fn() },
}));

import { models } from "@/lib/api/models";
import { preferences } from "@/lib/api/preferences";
import { usePlaygroundStore } from "@/lib/stores/playground-store";
import { ConnectedModelSelector } from "@/components/playground/model-selector";

const CONV_ID = "conv-1";

/** Locate the trigger button via its Bot icon — it carries no accessible
 *  name/label of its own. */
function triggerButton(): HTMLElement {
    const icon = document.querySelector("svg.lucide-bot");
    if (!icon) throw new Error("Bot trigger icon not found");
    return icon.closest("button") as HTMLElement;
}

function setModels(list: typeof chatModelGpt4o[]) {
    vi.mocked(models.useList).mockReturnValue(makeQuery({ data: list }));
}

function setPrefs(defaultModel = "") {
    vi.mocked(preferences.useGet).mockReturnValue(makeQuery({ data: makePreferences({ default_model: defaultModel }) }));
}

beforeEach(() => {
    resetPlaygroundStores();
    setModels([chatModelGpt4o, chatModelClaude]);
    setPrefs("");
});

afterEach(() => {
    resetPlaygroundStores();
});

describe("ConnectedModelSelector — trigger", () => {
    it("renders a disabled trigger while models are loading", () => {
        vi.mocked(models.useList).mockReturnValue(makeQuery({ data: undefined, isLoading: true }));
        renderWithClient(<ConnectedModelSelector conversationId={CONV_ID} />);
        expect(triggerButton()).toBeDisabled();
    });

    it("shows no badge when 0 or 1 models are selected", () => {
        usePlaygroundStore.getState().updateSettings(CONV_ID, { modelIds: ["gpt-4o"] });
        renderWithClient(<ConnectedModelSelector conversationId={CONV_ID} />);
        expect(within(triggerButton()).queryByText(/^\d+$/)).not.toBeInTheDocument();
    });

    it("shows the selection count badge when more than 1 model is selected", () => {
        usePlaygroundStore.getState().updateSettings(CONV_ID, { modelIds: ["gpt-4o", "claude-3-opus"] });
        renderWithClient(<ConnectedModelSelector conversationId={CONV_ID} />);
        expect(within(triggerButton()).getByText("2")).toBeInTheDocument();
    });
});

describe("ConnectedModelSelector — auto-select default model", () => {
    it("selects the user's default_model when it exists in the chat model catalog", async () => {
        setPrefs("claude-3-opus");
        renderWithClient(<ConnectedModelSelector conversationId={CONV_ID} />);
        await vi.waitFor(() =>
            expect(usePlaygroundStore.getState().getSettings(CONV_ID).modelIds).toEqual(["claude-3-opus"])
        );
    });

    it("falls back to gpt-3.5-turbo when default_model is unset and it exists in the catalog", async () => {
        setModels([chatModelGpt4o, chatModelGpt35]);
        setPrefs("");
        renderWithClient(<ConnectedModelSelector conversationId={CONV_ID} />);
        await vi.waitFor(() =>
            expect(usePlaygroundStore.getState().getSettings(CONV_ID).modelIds).toEqual(["gpt-3.5-turbo"])
        );
    });

    it("falls back to the first chat model when neither default_model nor gpt-3.5-turbo exist", async () => {
        setModels([chatModelClaude, chatModelGpt4o]);
        setPrefs("nonexistent-model");
        renderWithClient(<ConnectedModelSelector conversationId={CONV_ID} />);
        await vi.waitFor(() =>
            expect(usePlaygroundStore.getState().getSettings(CONV_ID).modelIds).toEqual(["claude-3-opus"])
        );
    });

    it("does not override an existing selection", async () => {
        usePlaygroundStore.getState().updateSettings(CONV_ID, { modelIds: ["claude-3-opus"] });
        setPrefs("gpt-4o");
        renderWithClient(<ConnectedModelSelector conversationId={CONV_ID} />);
        // Give the effect a tick to (not) fire.
        await new Promise((r) => setTimeout(r, 0));
        expect(usePlaygroundStore.getState().getSettings(CONV_ID).modelIds).toEqual(["claude-3-opus"]);
    });

    it("does not auto-select while loading or with an empty catalog", async () => {
        vi.mocked(models.useList).mockReturnValue(makeQuery({ data: [], isLoading: false }));
        renderWithClient(<ConnectedModelSelector conversationId={CONV_ID} />);
        await new Promise((r) => setTimeout(r, 0));
        expect(usePlaygroundStore.getState().getSettings(CONV_ID).modelIds).toBeUndefined();
    });
});

describe("ConnectedModelSelector — dropdown open/close", () => {
    it("opens the dropdown showing the model list on trigger click", async () => {
        const user = userEvent.setup();
        renderWithClient(<ConnectedModelSelector conversationId={CONV_ID} />);
        await user.click(triggerButton());
        expect(await screen.findByPlaceholderText("Search models...")).toBeInTheDocument();
        expect(screen.getByText("gpt-4o")).toBeInTheDocument();
        expect(screen.getByText("claude-3-opus")).toBeInTheDocument();
    });

    it("shows a loading row instead of the model list once opened, if a refetch flips isLoading back on", async () => {
        const user = userEvent.setup();
        const { rerender, queryClient } = renderWithClient(<ConnectedModelSelector conversationId={CONV_ID} />);
        await user.click(triggerButton());
        await screen.findByPlaceholderText("Search models...");

        // Simulate a background refetch flipping isLoading back to true
        // while the dropdown is already open (the trigger's `disabled`
        // guard only prevents *opening* while loading, not a mid-session
        // refetch).
        vi.mocked(models.useList).mockReturnValue(makeQuery({ data: undefined, isLoading: true }));
        rerender(
            <QueryClientProvider client={queryClient}>
                <ConnectedModelSelector conversationId={CONV_ID} />
            </QueryClientProvider>
        );
        expect(screen.getByText("Loading...")).toBeInTheDocument();
        expect(screen.queryByText("gpt-4o")).not.toBeInTheDocument();
    });

    it("shows 'No models found' when the chat catalog is empty", async () => {
        vi.mocked(models.useList).mockReturnValue(makeQuery({ data: [] }));
        const user = userEvent.setup();
        renderWithClient(<ConnectedModelSelector conversationId={CONV_ID} />);
        await user.click(triggerButton());
        expect(await screen.findByText("No models found")).toBeInTheDocument();
    });

    it("filters only chat-capability, enabled models out of the full catalog", async () => {
        setModels([chatModelGpt4o, chatModelDisabled, embeddingModel]);
        const user = userEvent.setup();
        renderWithClient(<ConnectedModelSelector conversationId={CONV_ID} />);
        await user.click(triggerButton());
        expect(await screen.findByText("gpt-4o")).toBeInTheDocument();
        expect(screen.queryByText("disabled-model")).not.toBeInTheDocument();
        expect(screen.queryByText("text-embedding-3-small")).not.toBeInTheDocument();
    });

    it("closes the dropdown when clicking outside", async () => {
        const user = userEvent.setup();
        renderWithClient(<ConnectedModelSelector conversationId={CONV_ID} />);
        await user.click(triggerButton());
        expect(await screen.findByPlaceholderText("Search models...")).toBeInTheDocument();
        fireEvent.mouseDown(document.body);
        expect(screen.queryByPlaceholderText("Search models...")).not.toBeInTheDocument();
    });

    it("re-toggles closed when clicking the trigger a second time", async () => {
        const user = userEvent.setup();
        renderWithClient(<ConnectedModelSelector conversationId={CONV_ID} />);
        await user.click(triggerButton());
        expect(await screen.findByPlaceholderText("Search models...")).toBeInTheDocument();
        await user.click(triggerButton());
        expect(screen.queryByPlaceholderText("Search models...")).not.toBeInTheDocument();
    });

    it("clears the search query when the dropdown is closed and reopened", async () => {
        const user = userEvent.setup();
        renderWithClient(<ConnectedModelSelector conversationId={CONV_ID} />);
        await user.click(triggerButton());
        const search = await screen.findByPlaceholderText("Search models...");
        await user.type(search, "claude");
        expect(screen.queryByText("gpt-4o")).not.toBeInTheDocument();

        await user.click(triggerButton()); // close
        await user.click(triggerButton()); // reopen
        const reopenedSearch = await screen.findByPlaceholderText("Search models...");
        expect(reopenedSearch).toHaveValue("");
        expect(screen.getByText("gpt-4o")).toBeInTheDocument();
    });
});

describe("ConnectedModelSelector — search filter", () => {
    it("narrows the list by case-insensitive substring match", async () => {
        const user = userEvent.setup();
        renderWithClient(<ConnectedModelSelector conversationId={CONV_ID} />);
        await user.click(triggerButton());
        const search = await screen.findByPlaceholderText("Search models...");
        await user.type(search, "GPT");
        expect(screen.getByText("gpt-4o")).toBeInTheDocument();
        expect(screen.queryByText("claude-3-opus")).not.toBeInTheDocument();
    });
});

describe("ConnectedModelSelector — multi-select toggling", () => {
    it("appends an unselected model to the current selection", async () => {
        usePlaygroundStore.getState().updateSettings(CONV_ID, { modelIds: ["gpt-4o"] });
        const user = userEvent.setup();
        renderWithClient(<ConnectedModelSelector conversationId={CONV_ID} />);
        await user.click(triggerButton());
        await user.click(await screen.findByText("claude-3-opus"));
        expect(usePlaygroundStore.getState().getSettings(CONV_ID).modelIds).toEqual(["gpt-4o", "claude-3-opus"]);
    });

    it("removes an already-selected model when more than one is selected", async () => {
        usePlaygroundStore.getState().updateSettings(CONV_ID, { modelIds: ["gpt-4o", "claude-3-opus"] });
        const user = userEvent.setup();
        renderWithClient(<ConnectedModelSelector conversationId={CONV_ID} />);
        await user.click(triggerButton());
        await user.click(await screen.findByText("gpt-4o"));
        expect(usePlaygroundStore.getState().getSettings(CONV_ID).modelIds).toEqual(["claude-3-opus"]);
    });

    it("keeps the last remaining model selected (can't deselect down to zero)", async () => {
        usePlaygroundStore.getState().updateSettings(CONV_ID, { modelIds: ["gpt-4o"] });
        const user = userEvent.setup();
        renderWithClient(<ConnectedModelSelector conversationId={CONV_ID} />);
        await user.click(triggerButton());
        await user.click(await screen.findByText("gpt-4o"));
        expect(usePlaygroundStore.getState().getSettings(CONV_ID).modelIds).toEqual(["gpt-4o"]);
    });

    it("does not close the dropdown after a multi-select pick", async () => {
        usePlaygroundStore.getState().updateSettings(CONV_ID, { modelIds: ["gpt-4o"] });
        const user = userEvent.setup();
        renderWithClient(<ConnectedModelSelector conversationId={CONV_ID} />);
        await user.click(triggerButton());
        await user.click(await screen.findByText("claude-3-opus"));
        expect(screen.getByPlaceholderText("Search models...")).toBeInTheDocument();
    });
});

describe("ConnectedModelSelector — single-model mode", () => {
    function singleModeToggle(): HTMLElement {
        const icon = document.querySelector("svg.lucide-layers");
        if (!icon) throw new Error("Layers icon not found");
        return icon.closest("button") as HTMLElement;
    }

    it("replaces the selection and closes the dropdown when picking in single mode", async () => {
        usePlaygroundStore.getState().updateSettings(CONV_ID, {
            modelIds: ["gpt-4o"],
            singleModelMode: true,
        });
        const user = userEvent.setup();
        renderWithClient(<ConnectedModelSelector conversationId={CONV_ID} />);
        await user.click(triggerButton());
        await user.click(await screen.findByText("claude-3-opus"));
        expect(usePlaygroundStore.getState().getSettings(CONV_ID).modelIds).toEqual(["claude-3-opus"]);
        expect(screen.queryByPlaceholderText("Search models...")).not.toBeInTheDocument();
    });

    it("toggles single-model mode via the layers button", async () => {
        usePlaygroundStore.getState().updateSettings(CONV_ID, { modelIds: ["gpt-4o"] });
        const user = userEvent.setup();
        renderWithClient(<ConnectedModelSelector conversationId={CONV_ID} />);
        await user.click(triggerButton());
        await screen.findByPlaceholderText("Search models...");
        await user.click(singleModeToggle());
        expect(usePlaygroundStore.getState().getSettings(CONV_ID).singleModelMode).toBe(true);
    });

    it("collapses an existing multi-selection down to the first model when switching into single mode", async () => {
        usePlaygroundStore.getState().updateSettings(CONV_ID, { modelIds: ["gpt-4o", "claude-3-opus"] });
        const user = userEvent.setup();
        renderWithClient(<ConnectedModelSelector conversationId={CONV_ID} />);
        await user.click(triggerButton());
        await screen.findByPlaceholderText("Search models...");
        await user.click(singleModeToggle());
        expect(usePlaygroundStore.getState().getSettings(CONV_ID).modelIds).toEqual(["gpt-4o"]);
    });

    it("does not collapse selection when toggling out of single mode", async () => {
        usePlaygroundStore.getState().updateSettings(CONV_ID, {
            modelIds: ["gpt-4o"],
            singleModelMode: true,
        });
        const user = userEvent.setup();
        renderWithClient(<ConnectedModelSelector conversationId={CONV_ID} />);
        await user.click(triggerButton());
        await screen.findByPlaceholderText("Search models...");
        await user.click(singleModeToggle());
        expect(usePlaygroundStore.getState().getSettings(CONV_ID).singleModelMode).toBe(false);
        expect(usePlaygroundStore.getState().getSettings(CONV_ID).modelIds).toEqual(["gpt-4o"]);
    });
});

describe("ConnectedModelSelector — dropdown positioning branches", () => {
    let rectSpy: ReturnType<typeof vi.spyOn>;

    afterEach(() => {
        rectSpy?.mockRestore();
    });

    it("opens below and anchors left when there's ample space below the trigger", async () => {
        rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
            top: 10, left: 10, right: 60, bottom: 40, width: 50, height: 30, x: 10, y: 10, toJSON() {},
        } as DOMRect);
        const user = userEvent.setup();
        renderWithClient(<ConnectedModelSelector conversationId={CONV_ID} />);
        await user.click(triggerButton());
        const search = await screen.findByPlaceholderText("Search models...");
        const dropdown = search.closest("div[style]") as HTMLElement;
        expect(dropdown.style.top).not.toBe("");
        expect(dropdown.style.bottom).toBe("");
        expect(dropdown.style.left).toBe("10px");
    });

    it("opens above and clamps left when the trigger is near the bottom-right corner", async () => {
        rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
            top: 700, left: 900, right: 950, bottom: 730, width: 50, height: 30, x: 900, y: 700, toJSON() {},
        } as DOMRect);
        const user = userEvent.setup();
        renderWithClient(<ConnectedModelSelector conversationId={CONV_ID} />);
        await user.click(triggerButton());
        const search = await screen.findByPlaceholderText("Search models...");
        const dropdown = search.closest("div[style]") as HTMLElement;
        expect(dropdown.style.bottom).not.toBe("");
        expect(dropdown.style.top).toBe("");
        expect(dropdown.style.left).toBe("630px");
    });

    it("recalculates position on window resize/scroll without crashing", async () => {
        const user = userEvent.setup();
        renderWithClient(<ConnectedModelSelector conversationId={CONV_ID} />);
        await user.click(triggerButton());
        await screen.findByPlaceholderText("Search models...");
        fireEvent.scroll(window);
        fireEvent(window, new Event("resize"));
        expect(screen.getByPlaceholderText("Search models...")).toBeInTheDocument();
    });
});
