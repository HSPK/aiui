import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithQuery, flushAsync } from "./_render";
import {
    providerWithHealth,
    modelOverride,
    modelDiscovered,
    capabilities,
    variants,
} from "./_fixtures";
import { makeQuery, makeMutation } from "./_mocks";

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

vi.mock("@/lib/api/models", () => ({
    models: {
        useList: vi.fn(),
        useCreate: vi.fn(),
        useUpdate: vi.fn(),
        useDelete: vi.fn(),
        list: vi.fn(),
        keys: { all: ["models"], list: () => ["models", "list"], one: (id: string) => ["models", id] },
    },
}));

vi.mock("@/lib/api/capabilities", () => ({
    capabilities: { useList: vi.fn() },
}));

vi.mock("@/lib/api/variants", () => ({
    variants: { useList: vi.fn() },
}));

vi.mock("sonner", () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { providers } from "@/lib/api/providers";
import { models } from "@/lib/api/models";
import { capabilities as capabilitiesApi } from "@/lib/api/capabilities";
import { variants as variantsApi } from "@/lib/api/variants";
import { toast } from "sonner";
import { ModelForm } from "@/components/providers/model-form";

const providerList = [providerWithHealth];

function setupMocks(overrides: {
    createMutate?: ReturnType<typeof vi.fn>;
    updateMutate?: ReturnType<typeof vi.fn>;
} = {}) {
    vi.mocked(providers.useList).mockReturnValue(makeQuery({ data: providerList }));
    vi.mocked(capabilitiesApi.useList).mockReturnValue(makeQuery({ data: capabilities }));
    vi.mocked(variantsApi.useList).mockReturnValue(makeQuery({ data: variants }));
    vi.mocked(models.useCreate).mockReturnValue(
        makeMutation({ mutate: (overrides.createMutate ?? vi.fn()) as any }),
    );
    vi.mocked(models.useUpdate).mockReturnValue(
        makeMutation({ mutate: (overrides.updateMutate ?? vi.fn()) as any }),
    );
}

beforeEach(() => setupMocks());

describe("ModelForm — create mode (pure)", () => {
    it("renders with empty name field", () => {
        renderWithQuery(<ModelForm mode="create" />);
        // Use label-associated input (Display name field)
        expect(screen.getByLabelText("Display name")).toHaveValue("");
    });

    it("starts with 'chat' capability selected", () => {
        renderWithQuery(<ModelForm mode="create" />);
        // The Capability label text should appear
        expect(screen.getByText("Capability")).toBeInTheDocument();
        // "Chat" text appears in the capability select trigger
        const comboboxes = screen.getAllByRole("combobox");
        const capabilityBox = comboboxes.find(el => el.textContent?.includes("Chat"));
        expect(capabilityBox).toBeTruthy();
    });

    it("starts enabled", () => {
        renderWithQuery(<ModelForm mode="create" />);
        expect(screen.getByRole("switch")).toBeChecked();
    });

    it("pre-selects provider from defaultProviderId", () => {
        renderWithQuery(<ModelForm mode="create" defaultProviderId="prov-1" />);
        // provider locked = false in pure create, but providerId is seeded
        // The select trigger should show provider name after data loads
        // Actually pure create is NOT locked — select is rendered
        // The selected value prov-1 maps to providerWithHealth.name "openai"
        expect(screen.getByText("openai")).toBeInTheDocument();
    });

    it("provider field is NOT locked in pure create (shows Select)", () => {
        renderWithQuery(<ModelForm mode="create" />);
        // Should see a combobox/listbox trigger for provider
        expect(screen.getByText("Select provider")).toBeInTheDocument();
    });

    it("toasts error when name is empty on submit", async () => {
        const user = userEvent.setup();
        renderWithQuery(<ModelForm mode="create" />);
        await user.click(screen.getByRole("button", { name: "Create" }));
        expect(vi.mocked(toast.error)).toHaveBeenCalledWith("Name required");
    });

    it("toasts error when provider is empty on submit", async () => {
        const user = userEvent.setup();
        renderWithQuery(<ModelForm mode="create" />);
        await user.type(screen.getByLabelText("Display name"), "mymodel");
        await user.click(screen.getByRole("button", { name: "Create" }));
        expect(vi.mocked(toast.error)).toHaveBeenCalledWith("Provider required");
    });

    it("toasts error when upstream model id is empty", async () => {
        const user = userEvent.setup();
        renderWithQuery(<ModelForm mode="create" />);
        await user.type(screen.getByLabelText("Display name"), "mymodel");
        // Select a provider via the combobox
        const comboboxes = screen.getAllByRole("combobox");
        const providerBox = comboboxes.find(el => el.textContent?.includes("Select provider"));
        await user.click(providerBox!);
        const openaiOption = await screen.findByRole("option", { name: "openai" });
        await user.click(openaiOption);
        // Now name is set, provider is set, upstream_model_id is empty → should error
        await user.click(screen.getByRole("button", { name: "Create" }));
        expect(vi.mocked(toast.error)).toHaveBeenCalledWith("Upstream model id required");
    });

    it("shows parse error for invalid JSON in default_params", async () => {
        const user = userEvent.setup();
        renderWithQuery(<ModelForm mode="create" />);
        await user.type(screen.getByLabelText("Display name"), "mymodel");
        // Select provider
        const comboboxes = screen.getAllByRole("combobox");
        const providerBox = comboboxes.find(el => el.textContent?.includes("Select provider"));
        await user.click(providerBox!);
        const openaiOption = await screen.findByRole("option", { name: "openai" });
        await user.click(openaiOption);
        await user.type(screen.getByLabelText("Upstream model ID"), "mymodel");
        const textarea = screen.getByLabelText("Default params (JSON)");
        await user.clear(textarea);
        await user.type(textarea, "bad json text");
        await user.click(screen.getByRole("button", { name: "Create" }));
        // The parse error span is rendered with class text-destructive
        const errorEl = document.querySelector(".text-destructive");
        expect(errorEl).toBeTruthy();
    });
});

describe("ModelForm — edit mode", () => {
    it("shows 'Save' button", () => {
        renderWithQuery(<ModelForm mode="edit" model={modelOverride} />);
        expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    });

    it("pre-fills name from model", () => {
        renderWithQuery(<ModelForm mode="edit" model={modelOverride} />);
        expect(screen.getByDisplayValue("gpt-4o")).toBeInTheDocument();
    });

    it("pre-fills upstream_model_id from model", () => {
        renderWithQuery(<ModelForm mode="edit" model={modelOverride} />);
        expect(screen.getByDisplayValue("gpt-4o-2024-08-06")).toBeInTheDocument();
    });

    it("provider field is locked in edit mode (shows readonly Input)", () => {
        renderWithQuery(<ModelForm mode="edit" model={modelOverride} />);
        // locked shows disabled input with provider name
        const readonlyInputs = screen.getAllByRole("textbox").filter(
            (el) => el.hasAttribute("readonly"),
        );
        expect(readonlyInputs.length).toBeGreaterThan(0);
    });

    it("uses api_variant_id when set", () => {
        renderWithQuery(<ModelForm mode="edit" model={modelOverride} />);
        // modelOverride has api_variant_id: "chat.completions" and 2 variants for chat
        // The "Upstream API" label should appear (meaning the dropdown is rendered)
        expect(screen.getByText("Upstream API")).toBeInTheDocument();
        // The select trigger for Upstream API shows the current variant
        const comboboxes = screen.getAllByRole("combobox");
        const variantBox = comboboxes.find(el => el.textContent?.includes("chat.completions"));
        expect(variantBox).toBeTruthy();
    });

    it("falls back to resolved_variant_id when api_variant_id is null", () => {
        const m = { ...modelOverride, api_variant_id: null, resolved_variant_id: "responses" };
        renderWithQuery(<ModelForm mode="edit" model={m} />);
        // apiVariantId will be "responses" (fallback), and 2 variants match "chat"
        expect(screen.getByText("Upstream API")).toBeInTheDocument();
        const comboboxes = screen.getAllByRole("combobox");
        const variantBox = comboboxes.find(el => el.textContent?.includes("responses"));
        expect(variantBox).toBeTruthy();
    });

    it("calls updateMutation with payload on submit", async () => {
        const user = userEvent.setup();
        const updateMutate = vi.fn();
        setupMocks({ updateMutate });
        renderWithQuery(<ModelForm mode="edit" model={modelOverride} />);
        await user.click(screen.getByRole("button", { name: "Save" }));
        await waitFor(() => expect(updateMutate).toHaveBeenCalledTimes(1));
        const { data } = updateMutate.mock.calls[0][0];
        expect(data.name).toBe("gpt-4o");
    });

    it("does NOT include discovered_metadata in edit mode even with meta.raw", async () => {
        const user = userEvent.setup();
        const updateMutate = vi.fn();
        setupMocks({ updateMutate });
        // modelDiscovered has meta.raw but in edit mode we shouldn't attach it
        renderWithQuery(<ModelForm mode="edit" model={modelDiscovered} />);
        await user.click(screen.getByRole("button", { name: "Save" }));
        await waitFor(() => expect(updateMutate).toHaveBeenCalledTimes(1));
        const { data } = updateMutate.mock.calls[0][0];
        expect("discovered_metadata" in data).toBe(false);
    });
});

describe("ModelForm — discovered-promote (create+discovered)", () => {
    it("provider field is locked when promoting a discovered model", () => {
        renderWithQuery(<ModelForm mode="create" model={modelDiscovered} />);
        const readonlyInputs = screen.getAllByRole("textbox").filter(
            (el) => el.hasAttribute("readonly"),
        );
        expect(readonlyInputs.length).toBeGreaterThan(0);
    });

    it("includes discovered_metadata when upstream_model_id unchanged", async () => {
        const user = userEvent.setup();
        const createMutate = vi.fn();
        setupMocks({ createMutate });
        renderWithQuery(<ModelForm mode="create" model={modelDiscovered} />);
        await user.click(screen.getByRole("button", { name: "Save" }));
        await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
        const arg = createMutate.mock.calls[0][0];
        expect(arg.discovered_metadata).toEqual(modelDiscovered.meta!.raw);
    });

    it("does NOT include discovered_metadata when upstream_model_id changed", async () => {
        const user = userEvent.setup();
        const createMutate = vi.fn();
        setupMocks({ createMutate });
        renderWithQuery(<ModelForm mode="create" model={modelDiscovered} />);
        // Change upstream model id using the labeled input
        const upstreamInput = screen.getByLabelText("Upstream model ID");
        await user.clear(upstreamInput);
        await user.type(upstreamInput, "new-model-id");
        await user.click(screen.getByRole("button", { name: "Save" }));
        await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
        const arg = createMutate.mock.calls[0][0];
        expect("discovered_metadata" in arg).toBe(false);
    });
});

describe("ModelForm — variant dropdown visibility", () => {
    it("shows variant dropdown when >1 variants for type and apiVariantId is set", () => {
        // modelOverride has type:"chat", api_variant_id:"chat.completions"
        // variants fixture has 2 chat variants
        renderWithQuery(<ModelForm mode="edit" model={modelOverride} />);
        // "Upstream API" label should appear
        expect(screen.getByText("Upstream API")).toBeInTheDocument();
    });

    it("hides variant dropdown when type has only 1 variant", () => {
        // embedding has only 1 variant
        const m = { ...modelOverride, type: "embedding", api_variant_id: "embeddings", resolved_variant_id: "embeddings" };
        renderWithQuery(<ModelForm mode="edit" model={m} />);
        expect(screen.queryByText("Upstream API")).toBeNull();
    });

    it("hides variant dropdown when apiVariantId is empty", () => {
        const m = { ...modelOverride, api_variant_id: null, resolved_variant_id: null };
        renderWithQuery(<ModelForm mode="edit" model={m} />);
        expect(screen.queryByText("Upstream API")).toBeNull();
    });
});

describe("ModelForm — mutation callbacks", () => {
    it("toasts success and calls onSaved when create mutation succeeds", () => {
        const onSaved = vi.fn();
        renderWithQuery(<ModelForm mode="create" onSaved={onSaved} />);
        // Capture the onSuccess callback from models.useCreate
        const createOpts = vi.mocked(models.useCreate).mock.calls[0][0] as { onSuccess: (d: typeof modelOverride) => void };
        createOpts.onSuccess(modelOverride);
        expect(vi.mocked(toast.success)).toHaveBeenCalledWith("Saved");
        expect(onSaved).toHaveBeenCalledWith(modelOverride);
    });

    it("toasts error when create mutation fails", () => {
        renderWithQuery(<ModelForm mode="create" />);
        const createOpts = vi.mocked(models.useCreate).mock.calls[0][0] as { onError: (e: Error) => void };
        createOpts.onError(new Error("Create failed"));
        expect(vi.mocked(toast.error)).toHaveBeenCalledWith("Create failed");
    });

    it("toasts success and calls onSaved when update mutation succeeds", () => {
        const onSaved = vi.fn();
        renderWithQuery(<ModelForm mode="edit" model={modelOverride} onSaved={onSaved} />);
        const updateOpts = vi.mocked(models.useUpdate).mock.calls[0][0] as { onSuccess: (d: typeof modelOverride) => void };
        updateOpts.onSuccess(modelOverride);
        expect(vi.mocked(toast.success)).toHaveBeenCalledWith("Saved");
        expect(onSaved).toHaveBeenCalledWith(modelOverride);
    });

    it("toasts error when update mutation fails", () => {
        renderWithQuery(<ModelForm mode="edit" model={modelOverride} />);
        const updateOpts = vi.mocked(models.useUpdate).mock.calls[0][0] as { onError: (e: Error) => void };
        updateOpts.onError(new Error("Update failed"));
        expect(vi.mocked(toast.error)).toHaveBeenCalledWith("Update failed");
    });

    it("uses fallback 'Save failed' message when error has no message", () => {
        renderWithQuery(<ModelForm mode="create" />);
        const createOpts = vi.mocked(models.useCreate).mock.calls[0][0] as { onError: (e: { message: string }) => void };
        createOpts.onError({ message: "" }); // empty message triggers || fallback
        expect(vi.mocked(toast.error)).toHaveBeenCalledWith("Save failed");
    });

    it("onSaved not provided → create still toasts success without crashing", () => {
        // No onSaved prop - covers the `?.` branch where onSaved is undefined
        renderWithQuery(<ModelForm mode="create" />);
        const createOpts = vi.mocked(models.useCreate).mock.calls[0][0] as { onSuccess: (d: typeof modelOverride) => void };
        createOpts.onSuccess(modelOverride);
        expect(vi.mocked(toast.success)).toHaveBeenCalledWith("Saved");
    });
});

describe("ModelForm — input field interactions", () => {
    it("typing in context_window and submitting includes it in payload", async () => {
        const user = userEvent.setup();
        const updateMutate = vi.fn();
        setupMocks({ updateMutate });
        renderWithQuery(<ModelForm mode="edit" model={modelOverride} />);
        const ctxInput = screen.getByLabelText("Context window");
        await user.clear(ctxInput);
        await user.type(ctxInput, "4096");
        await user.click(screen.getByRole("button", { name: "Save" }));
        await waitFor(() => expect(updateMutate).toHaveBeenCalledTimes(1));
        const { data } = updateMutate.mock.calls[0][0];
        expect(data.context_window).toBe(4096);
    });

    it("typing in max_tokens and description submits correctly", async () => {
        const user = userEvent.setup();
        const updateMutate = vi.fn();
        setupMocks({ updateMutate });
        renderWithQuery(<ModelForm mode="edit" model={modelOverride} />);
        const maxInput = screen.getByLabelText("Max tokens");
        await user.clear(maxInput);
        await user.type(maxInput, "1024");
        const descInput = screen.getByLabelText("Description");
        await user.clear(descInput);
        await user.type(descInput, "My test model");
        await user.click(screen.getByRole("button", { name: "Save" }));
        await waitFor(() => expect(updateMutate).toHaveBeenCalledTimes(1));
        const { data } = updateMutate.mock.calls[0][0];
        expect(data.max_tokens).toBe(1024);
        expect(data.description).toBe("My test model");
    });

    it("typing in output_dimension submits correctly", async () => {
        const user = userEvent.setup();
        const updateMutate = vi.fn();
        setupMocks({ updateMutate });
        renderWithQuery(<ModelForm mode="edit" model={{ ...modelOverride, type: "embedding", api_variant_id: "embeddings", resolved_variant_id: "embeddings" }} />);
        const dimInput = screen.getByLabelText("Output dim");
        await user.clear(dimInput);
        await user.type(dimInput, "1536");
        await user.click(screen.getByRole("button", { name: "Save" }));
        await waitFor(() => expect(updateMutate).toHaveBeenCalledTimes(1));
        const { data } = updateMutate.mock.calls[0][0];
        expect(data.output_dimension).toBe(1536);
    });

    it("calls onCancel when Cancel button clicked", async () => {
        const user = userEvent.setup();
        const onCancel = vi.fn();
        renderWithQuery(<ModelForm mode="create" onCancel={onCancel} />);
        await user.click(screen.getByRole("button", { name: "Cancel" }));
        expect(onCancel).toHaveBeenCalledTimes(1);
    });
});

describe("ModelForm — optional field null branches", () => {
    it("submits with null optional fields when left empty in create mode", async () => {
        const user = userEvent.setup();
        const createMutate = vi.fn();
        setupMocks({ createMutate });
        renderWithQuery(<ModelForm mode="create" />);
        // Fill required fields
        await user.type(screen.getByLabelText("Display name"), "mymodel");
        // Select provider
        const comboboxes = screen.getAllByRole("combobox");
        const providerBox = comboboxes.find(el => el.textContent?.includes("Select provider"));
        await user.click(providerBox!);
        const openaiOption = await screen.findByRole("option", { name: "openai" });
        await user.click(openaiOption);
        await user.type(screen.getByLabelText("Upstream model ID"), "mymodel");
        // Clear default params to hit the empty-defaultParams branch
        const textarea = screen.getByLabelText("Default params (JSON)");
        await user.clear(textarea);
        // Leave contextWindow, maxTokens, outputDim, description empty
        await user.click(screen.getByRole("button", { name: "Create" }));
        await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
        const arg = createMutate.mock.calls[0][0];
        expect(arg.context_window).toBeNull();
        expect(arg.max_tokens).toBeNull();
        expect(arg.output_dimension).toBeNull();
        expect(arg.description).toBeNull();
        expect(arg.api_variant_id).toBeNull(); // empty apiVariantId → null
    });

    it("shows loading spinner when mutation is pending", () => {
        vi.mocked(models.useCreate).mockReturnValue(makeMutation({ isPending: true }));
        renderWithQuery(<ModelForm mode="create" />);
        // The submit button is disabled when loading
        expect(screen.getByRole("button", { name: /Save|Create/i })).toBeDisabled();
    });

    it("renders with null/undefined list data (providerList/capabilityList null branches)", () => {
        // Cover ?? [] null branches for providerList, capabilityList, variantList
        vi.mocked(providers.useList).mockReturnValue(makeQuery({}));
        vi.mocked(capabilitiesApi.useList).mockReturnValue(makeQuery({}));
        vi.mocked(variantsApi.useList).mockReturnValue(makeQuery({}));
        renderWithQuery(<ModelForm mode="create" />);
        // Provider Select shows empty placeholder
        expect(screen.getByText("Select provider")).toBeInTheDocument();
    });

    it("renders unknown capability type as SelectItem in Capability dropdown", async () => {
        const user = userEvent.setup();
        // Render with empty capabilityList and default type="chat" (create mode)
        // The branch fires when type is not in capabilityList
        vi.mocked(capabilitiesApi.useList).mockReturnValue(makeQuery({ data: [] }));
        renderWithQuery(<ModelForm mode="create" />);
        // Capability Select combobox should show "chat" (default type; branch adds it)
        const comboboxes = screen.getAllByRole("combobox");
        const capBox = comboboxes.find(el => el.textContent?.includes("chat") || el.textContent === "");
        await user.click(capBox ?? comboboxes[0]);
        // The branch item "chat" (unknown to capabilities list) should appear
        const opt = await screen.findByRole("option", { name: "chat" });
        expect(opt).toBeInTheDocument();
    });

    it("shows unknown api_variant_id as SelectItem in Upstream API dropdown", async () => {
        const user = userEvent.setup();
        // Model with api_variant_id not matching any known variant, type=chat (2 variants → dropdown visible)
        const unknownVariantModel = { ...modelOverride, type: "chat" as const, api_variant_id: "unknown-variant" };
        renderWithQuery(<ModelForm mode="edit" model={unknownVariantModel} />);
        // Open Upstream API Select to trigger the unknown-variant SelectItem branch
        const comboboxes = screen.getAllByRole("combobox");
        const upstreamBox = comboboxes.find(el => el.textContent?.includes("unknown-variant"));
        await user.click(upstreamBox!);
        const opt = await screen.findByRole("option", { name: "unknown-variant" });
        expect(opt).toBeInTheDocument();
    });
});
