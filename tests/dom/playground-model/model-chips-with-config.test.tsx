// Tests for components/playground/model-chips-with-config.tsx.
//
// Composes the real ModelConfigPopover per selected model (already
// covered by model-config-popover.test.tsx) plus a real Radix Popover
// for conversation-level settings (history limit, system prompt).
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithClient, resetPlaygroundStores } from "./_render";
import { makeQuery } from "./_mocks";
import { makePreferences } from "./_fixtures";

vi.mock("@/lib/api/models", () => ({
    models: { useList: vi.fn() },
}));
vi.mock("@/lib/api/preferences", () => ({
    preferences: { useGet: vi.fn() },
}));

import { models } from "@/lib/api/models";
import { preferences } from "@/lib/api/preferences";
import { usePlaygroundStore } from "@/lib/stores/playground-store";
import { ModelChipsWithConfig } from "@/components/playground/model-chips-with-config";
import type { ModelDTO } from "@/lib/schemas/model";

const CONV_ID = "conv-1";

function setModels(list: Partial<ModelDTO>[]) {
    vi.mocked(models.useList).mockReturnValue(makeQuery({ data: list as ModelDTO[] }));
}

function setPrefs(overrides: Parameters<typeof makePreferences>[0] = {}) {
    vi.mocked(preferences.useGet).mockReturnValue(makeQuery({ data: makePreferences(overrides) }));
}

function chipButton(modelId: string): HTMLElement {
    return screen.getByText(modelId).closest("button") as HTMLElement;
}

function gearButton(): HTMLElement {
    const icon = document.querySelector("svg.lucide-settings-2");
    if (!icon) throw new Error("Settings2 gear icon not found");
    return icon.closest("button") as HTMLElement;
}

beforeEach(() => {
    resetPlaygroundStores();
    setModels([
        { name: "gpt-4o", provider: "openai", enabled: true, type: "chat" },
        { name: "claude-3-opus", provider: "claude", enabled: true, type: "chat" },
    ]);
    setPrefs();
});

afterEach(() => {
    resetPlaygroundStores();
});

describe("ModelChipsWithConfig — visibility", () => {
    it("renders nothing when no models are selected for the conversation", () => {
        const { container } = renderWithClient(<ModelChipsWithConfig conversationId={CONV_ID} />);
        expect(container).toBeEmptyDOMElement();
    });

    it("renders one chip per selected model, with the settings gear alongside", () => {
        usePlaygroundStore.getState().updateSettings(CONV_ID, { modelIds: ["gpt-4o", "claude-3-opus"] });
        renderWithClient(<ModelChipsWithConfig conversationId={CONV_ID} />);
        expect(chipButton("gpt-4o")).toBeInTheDocument();
        expect(chipButton("claude-3-opus")).toBeInTheDocument();
        expect(gearButton()).toBeInTheDocument();
    });
});

describe("ModelChipsWithConfig — stale detection", () => {
    it("marks a chip 'missing' when the model id is no longer in the catalog", () => {
        usePlaygroundStore.getState().updateSettings(CONV_ID, { modelIds: ["deleted-model", "gpt-4o"] });
        renderWithClient(<ModelChipsWithConfig conversationId={CONV_ID} />);
        expect(chipButton("deleted-model")).toHaveAttribute(
            "title",
            "deleted-model (missing) — remove and re-pick"
        );
    });

    it("marks a chip 'unavailable' when the model has been disabled", () => {
        setModels([{ name: "gpt-4o", provider: "openai", enabled: false, type: "chat" }]);
        usePlaygroundStore.getState().updateSettings(CONV_ID, { modelIds: ["gpt-4o"] });
        renderWithClient(<ModelChipsWithConfig conversationId={CONV_ID} />);
        expect(chipButton("gpt-4o")).toHaveAttribute(
            "title",
            "gpt-4o (unavailable) — remove and re-pick"
        );
    });

    it("marks a chip 'unavailable' when the model's capability type is no longer chat", () => {
        setModels([{ name: "gpt-4o", provider: "openai", enabled: true, type: "embedding" }]);
        usePlaygroundStore.getState().updateSettings(CONV_ID, { modelIds: ["gpt-4o"] });
        renderWithClient(<ModelChipsWithConfig conversationId={CONV_ID} />);
        expect(chipButton("gpt-4o")).toHaveAttribute(
            "title",
            "gpt-4o (unavailable) — remove and re-pick"
        );
    });

    it("does not mark a chip stale when the model is present, enabled and still chat-capable", () => {
        usePlaygroundStore.getState().updateSettings(CONV_ID, { modelIds: ["gpt-4o"] });
        renderWithClient(<ModelChipsWithConfig conversationId={CONV_ID} />);
        expect(chipButton("gpt-4o")).toHaveAttribute("title", "gpt-4o");
    });

    it("treats a null provider on the model record the same as an unset provider (openai icon fallback)", () => {
        setModels([{ name: "gpt-4o", provider: null, enabled: true, type: "chat" }]);
        usePlaygroundStore.getState().updateSettings(CONV_ID, { modelIds: ["gpt-4o"] });
        renderWithClient(<ModelChipsWithConfig conversationId={CONV_ID} />);
        expect(document.querySelector('img[src="/providers/openai.svg"]')).toBeInTheDocument();
    });
});

describe("ModelChipsWithConfig — remove affordance gating", () => {
    it("hides the remove (X) affordance when only one model is selected", () => {
        usePlaygroundStore.getState().updateSettings(CONV_ID, { modelIds: ["gpt-4o"] });
        renderWithClient(<ModelChipsWithConfig conversationId={CONV_ID} />);
        expect(document.querySelector("svg.lucide-x")).not.toBeInTheDocument();
    });

    it("shows the remove (X) affordance on every chip when more than one model is selected", () => {
        usePlaygroundStore.getState().updateSettings(CONV_ID, { modelIds: ["gpt-4o", "claude-3-opus"] });
        renderWithClient(<ModelChipsWithConfig conversationId={CONV_ID} />);
        expect(document.querySelectorAll("svg.lucide-x")).toHaveLength(2);
    });

    it("removing a chip filters it out of modelIds and drops its modelConfigs entry, leaving others untouched", async () => {
        const user = userEvent.setup();
        usePlaygroundStore.getState().updateSettings(CONV_ID, {
            modelIds: ["gpt-4o", "claude-3-opus"],
            modelConfigs: { "gpt-4o": { temperature: 0.5 }, "claude-3-opus": { topP: 0.8 } },
        });
        renderWithClient(<ModelChipsWithConfig conversationId={CONV_ID} />);

        const claudeChip = chipButton("claude-3-opus");
        const xIcon = claudeChip.querySelector("svg.lucide-x") as Element;
        await user.click(xIcon);

        const settings = usePlaygroundStore.getState().getSettings(CONV_ID);
        expect(settings.modelIds).toEqual(["gpt-4o"]);
        expect(settings.modelConfigs).toEqual({ "gpt-4o": { temperature: 0.5 } });
    });

    it("removing a chip when modelConfigs was never initialized still works (nullish-fallback branch)", async () => {
        const user = userEvent.setup();
        // Only modelIds is set — modelConfigs is genuinely undefined,
        // exercising the `settings.modelConfigs ?? {}` fallback.
        usePlaygroundStore.getState().updateSettings(CONV_ID, {
            modelIds: ["gpt-4o", "claude-3-opus"],
        });
        renderWithClient(<ModelChipsWithConfig conversationId={CONV_ID} />);

        const claudeChip = chipButton("claude-3-opus");
        const xIcon = claudeChip.querySelector("svg.lucide-x") as Element;
        await user.click(xIcon);

        const settings = usePlaygroundStore.getState().getSettings(CONV_ID);
        expect(settings.modelIds).toEqual(["gpt-4o"]);
        expect(settings.modelConfigs).toEqual({});
    });
});

describe("ModelChipsWithConfig — per-model config flows through to the store", () => {
    it("toggling a param in one model's popover updates only that model's modelConfigs entry", async () => {
        const user = userEvent.setup();
        usePlaygroundStore.getState().updateSettings(CONV_ID, {
            modelIds: ["gpt-4o", "claude-3-opus"],
            modelConfigs: { "claude-3-opus": { topP: 0.9 } },
        });
        renderWithClient(<ModelChipsWithConfig conversationId={CONV_ID} />);

        await user.click(chipButton("gpt-4o"));
        const temperatureRow = screen.getByText("Temperature").closest(".group") as HTMLElement;
        await user.click(temperatureRow.querySelector(".cursor-pointer") as HTMLElement);

        const settings = usePlaygroundStore.getState().getSettings(CONV_ID);
        expect(settings.modelConfigs).toEqual({
            "gpt-4o": { temperature: 1 },
            "claude-3-opus": { topP: 0.9 },
        });
    });

    it("toggling a param when modelConfigs was never initialized still works (nullish-fallback branch)", async () => {
        const user = userEvent.setup();
        // Only modelIds is set this time — modelConfigs is genuinely
        // undefined, exercising the `getSettings(...).modelConfigs ?? {}`
        // fallback inside handleConfigChange.
        usePlaygroundStore.getState().updateSettings(CONV_ID, { modelIds: ["gpt-4o"] });
        renderWithClient(<ModelChipsWithConfig conversationId={CONV_ID} />);

        await user.click(chipButton("gpt-4o"));
        const temperatureRow = screen.getByText("Temperature").closest(".group") as HTMLElement;
        await user.click(temperatureRow.querySelector(".cursor-pointer") as HTMLElement);

        expect(usePlaygroundStore.getState().getSettings(CONV_ID).modelConfigs).toEqual({
            "gpt-4o": { temperature: 1 },
        });
    });
});

describe("ModelChipsWithConfig — conversation settings popover", () => {
    it("seeds history limit and system prompt from user preferences when there is no per-conversation override", async () => {
        setPrefs({ default_history_limit: 15, default_system_prompt: "Prefs prompt" });
        usePlaygroundStore.getState().updateSettings(CONV_ID, { modelIds: ["gpt-4o"] });
        const user = userEvent.setup();
        renderWithClient(<ModelChipsWithConfig conversationId={CONV_ID} />);

        await user.click(gearButton());
        expect(await screen.findByLabelText("History limit")).toHaveValue(15);
        expect(screen.getByLabelText("System prompt")).toHaveValue("Prefs prompt");
    });

    it("seeds from the per-conversation override when present, ignoring preferences", async () => {
        setPrefs({ default_history_limit: 15, default_system_prompt: "Prefs prompt" });
        usePlaygroundStore.getState().updateSettings(CONV_ID, {
            modelIds: ["gpt-4o"],
            historyLimit: 40,
            systemPrompt: "Conversation-specific prompt",
        });
        const user = userEvent.setup();
        renderWithClient(<ModelChipsWithConfig conversationId={CONV_ID} />);

        await user.click(gearButton());
        expect(await screen.findByLabelText("History limit")).toHaveValue(40);
        expect(screen.getByLabelText("System prompt")).toHaveValue("Conversation-specific prompt");
    });

    it("commits a history limit edit to the store on blur", async () => {
        usePlaygroundStore.getState().updateSettings(CONV_ID, { modelIds: ["gpt-4o"] });
        const user = userEvent.setup();
        renderWithClient(<ModelChipsWithConfig conversationId={CONV_ID} />);

        await user.click(gearButton());
        const input = await screen.findByLabelText("History limit");
        fireEvent.change(input, { target: { value: "25" } });
        expect(input).toHaveValue(25);
        fireEvent.blur(input);

        expect(usePlaygroundStore.getState().getSettings(CONV_ID).historyLimit).toBe(25);
    });

    it("falls back to 1 when the history limit field is cleared (parseInt NaN guard)", async () => {
        usePlaygroundStore.getState().updateSettings(CONV_ID, { modelIds: ["gpt-4o"] });
        const user = userEvent.setup();
        renderWithClient(<ModelChipsWithConfig conversationId={CONV_ID} />);

        await user.click(gearButton());
        const input = await screen.findByLabelText("History limit");
        fireEvent.change(input, { target: { value: "" } });
        expect(input).toHaveValue(1);
        fireEvent.blur(input);

        expect(usePlaygroundStore.getState().getSettings(CONV_ID).historyLimit).toBe(1);
    });

    it("commits a system prompt edit to the store on blur", async () => {
        usePlaygroundStore.getState().updateSettings(CONV_ID, { modelIds: ["gpt-4o"] });
        const user = userEvent.setup();
        renderWithClient(<ModelChipsWithConfig conversationId={CONV_ID} />);

        await user.click(gearButton());
        const textarea = await screen.findByLabelText("System prompt");
        fireEvent.change(textarea, { target: { value: "New system prompt" } });
        fireEvent.blur(textarea);

        expect(usePlaygroundStore.getState().getSettings(CONV_ID).systemPrompt).toBe("New system prompt");
    });

    it("re-syncs local fields from the resolved values whenever the popover is open and they change externally", async () => {
        usePlaygroundStore.getState().updateSettings(CONV_ID, { modelIds: ["gpt-4o"], historyLimit: 10 });
        const user = userEvent.setup();
        renderWithClient(<ModelChipsWithConfig conversationId={CONV_ID} />);

        await user.click(gearButton());
        expect(await screen.findByLabelText("History limit")).toHaveValue(10);

        // Simulated external change (e.g. another control, or a cross-tab
        // sync) while the popover is still open — the effect keyed on
        // [popoverOpen, historyLimit, systemPrompt] re-syncs immediately.
        usePlaygroundStore.getState().updateSettings(CONV_ID, { historyLimit: 30 });
        expect(await screen.findByLabelText("History limit")).toHaveValue(30);
    });
});
