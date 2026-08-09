// Tests for components/playground/modality-multi-model-selector.tsx
// (ModalityMultiModelSelector) — the multi-pick model selector used by
// the embedding playground (and any future multi-model modality).
//
// Uses Radix `Popover` (like modality-model-selector.tsx), so it's driven
// with `userEvent` clicks and queried via `data-slot="popover-trigger"` /
// `data-slot="popover-content"` to disambiguate the trigger from dropdown
// rows and chips once a model name appears in multiple places.
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithClient } from "./_render";
import { makeQuery } from "./_mocks";
import {
    chatModelGpt4o,
    heuristicImageModel,
    imageModelDalle3,
    imageModelDisabled,
    imageModelGptImage,
    imageModelSdxl,
    imageModelSparse,
} from "./_fixtures";

vi.mock("@/lib/api/models", () => ({
    models: { useList: vi.fn() },
}));

import { models } from "@/lib/api/models";
import { ModalityMultiModelSelector } from "@/components/playground/modality-multi-model-selector";

function setModels(list: unknown[] | undefined, overrides: Record<string, unknown> = {}) {
    vi.mocked(models.useList).mockReturnValue(makeQuery({ data: list as never, ...overrides }));
}

function trigger(): HTMLElement {
    return document.querySelector('[data-slot="popover-trigger"]') as HTMLElement;
}

function popoverContent(): HTMLElement | null {
    return document.querySelector('[data-slot="popover-content"]');
}

function removeButton(name: string): HTMLElement {
    return screen.getByRole("button", { name: `Remove ${name}` });
}

const DEFAULT_CATALOG = [imageModelDalle3, imageModelSdxl, imageModelGptImage, imageModelDisabled, chatModelGpt4o];

describe("ModalityMultiModelSelector — trigger label", () => {
    it("disables the trigger and shows 'Loading…' while loading with no selection", () => {
        setModels(undefined, { isLoading: true });
        renderWithClient(<ModalityMultiModelSelector capability="image" value={[]} onChange={vi.fn()} />);
        expect(trigger()).toBeDisabled();
        expect(within(trigger()).getByText("Loading…")).toBeInTheDocument();
    });

    it("shows 'Pick models' when not loading and nothing is selected", () => {
        setModels(DEFAULT_CATALOG);
        renderWithClient(<ModalityMultiModelSelector capability="image" value={[]} onChange={vi.fn()} />);
        expect(within(trigger()).getByText("Pick models")).toBeInTheDocument();
        expect(trigger()).not.toBeDisabled();
    });

    it("shows the singular '1 model' label for exactly one selection", () => {
        setModels(DEFAULT_CATALOG);
        renderWithClient(
            <ModalityMultiModelSelector capability="image" value={["dall-e-3"]} onChange={vi.fn()} />
        );
        expect(within(trigger()).getByText("1 model")).toBeInTheDocument();
    });

    it("shows the plural 'N models' label for more than one selection", () => {
        setModels(DEFAULT_CATALOG);
        renderWithClient(
            <ModalityMultiModelSelector
                capability="image"
                value={["dall-e-3", "stable-diffusion-xl"]}
                onChange={vi.fn()}
            />
        );
        expect(within(trigger()).getByText("2 models")).toBeInTheDocument();
    });

    it("prioritises the selection-count label over 'Loading…' when a background refetch is in flight with an existing selection", () => {
        setModels(DEFAULT_CATALOG, { isLoading: true });
        renderWithClient(
            <ModalityMultiModelSelector capability="image" value={["dall-e-3"]} onChange={vi.fn()} />
        );
        expect(within(trigger()).getByText("1 model")).toBeInTheDocument();
        expect(within(trigger()).queryByText("Loading…")).not.toBeInTheDocument();
    });

    it("applies a caller-supplied className to the outer wrapper", () => {
        setModels(DEFAULT_CATALOG);
        renderWithClient(
            <ModalityMultiModelSelector
                capability="image"
                value={[]}
                onChange={vi.fn()}
                className="my-multi-marker"
            />
        );
        expect(trigger().parentElement).toHaveClass("my-multi-marker");
    });
});

describe("ModalityMultiModelSelector — dropdown catalog + filtering", () => {
    it("opens the dropdown with a capability-scoped search placeholder", async () => {
        setModels(DEFAULT_CATALOG);
        const user = userEvent.setup();
        renderWithClient(<ModalityMultiModelSelector capability="image" value={[]} onChange={vi.fn()} />);
        await user.click(trigger());
        expect(await screen.findByPlaceholderText("Search image models…")).toBeInTheDocument();
    });

    it("lists only enabled, capability-matching models, excluding disabled and mismatched ones", async () => {
        setModels(DEFAULT_CATALOG);
        const user = userEvent.setup();
        renderWithClient(<ModalityMultiModelSelector capability="image" value={[]} onChange={vi.fn()} />);
        await user.click(trigger());
        await screen.findByPlaceholderText("Search image models…");
        const content = popoverContent() as HTMLElement;
        expect(within(content).getByText("dall-e-3")).toBeInTheDocument();
        expect(within(content).getByText("stable-diffusion-xl")).toBeInTheDocument();
        expect(within(content).getByText("gpt-image-1")).toBeInTheDocument();
        expect(within(content).queryByText("disabled-image-model")).not.toBeInTheDocument();
        expect(within(content).queryByText("gpt-4o")).not.toBeInTheDocument();
    });

    it("includes a model matched only via the name heuristic, tagged with its real type", async () => {
        setModels([imageModelDalle3, heuristicImageModel]);
        const user = userEvent.setup();
        renderWithClient(<ModalityMultiModelSelector capability="image" value={[]} onChange={vi.fn()} />);
        await user.click(trigger());
        const content = popoverContent() as HTMLElement;
        const row = (await within(content).findByText("flux-pro")).closest("button") as HTMLElement;
        expect(within(row).getByText("chat")).toBeInTheDocument();
    });

    it("does not show a type badge for a model whose type matches the capability", async () => {
        setModels(DEFAULT_CATALOG);
        const user = userEvent.setup();
        renderWithClient(<ModalityMultiModelSelector capability="image" value={[]} onChange={vi.fn()} />);
        await user.click(trigger());
        const content = popoverContent() as HTMLElement;
        const row = (await within(content).findByText("dall-e-3")).closest("button") as HTMLElement;
        expect(within(row).queryByText("image")).not.toBeInTheDocument();
    });

    it("filters the list by a case-insensitive name substring", async () => {
        setModels(DEFAULT_CATALOG);
        const user = userEvent.setup();
        renderWithClient(<ModalityMultiModelSelector capability="image" value={[]} onChange={vi.fn()} />);
        await user.click(trigger());
        const search = await screen.findByPlaceholderText("Search image models…");
        await user.type(search, "DALL");
        const content = popoverContent() as HTMLElement;
        expect(within(content).getByText("dall-e-3")).toBeInTheDocument();
        expect(within(content).queryByText("stable-diffusion-xl")).not.toBeInTheDocument();
    });

    it("filters the list by a model_id substring", async () => {
        setModels(DEFAULT_CATALOG);
        const user = userEvent.setup();
        renderWithClient(<ModalityMultiModelSelector capability="image" value={[]} onChange={vi.fn()} />);
        await user.click(trigger());
        const search = await screen.findByPlaceholderText("Search image models…");
        await user.type(search, "sdxl");
        const content = popoverContent() as HTMLElement;
        expect(within(content).getByText("stable-diffusion-xl")).toBeInTheDocument();
        expect(within(content).queryByText("dall-e-3")).not.toBeInTheDocument();
    });

    it("renders and still name-filters a model with a null provider/model_id without crashing", async () => {
        setModels([imageModelDalle3, imageModelSparse]);
        const user = userEvent.setup();
        renderWithClient(<ModalityMultiModelSelector capability="image" value={[]} onChange={vi.fn()} />);
        await user.click(trigger());
        const search = await screen.findByPlaceholderText("Search image models…");
        await user.type(search, "sparse");
        const content = popoverContent() as HTMLElement;
        expect(within(content).getByText("sparse-image-model")).toBeInTheDocument();
        expect(within(content).queryByText("dall-e-3")).not.toBeInTheDocument();
    });

    it("shows the no-results message when a search matches nothing, without crashing", async () => {
        setModels(DEFAULT_CATALOG);
        const user = userEvent.setup();
        renderWithClient(<ModalityMultiModelSelector capability="image" value={[]} onChange={vi.fn()} />);
        await user.click(trigger());
        const search = await screen.findByPlaceholderText("Search image models…");
        await user.type(search, "nonexistent-xyz");
        expect(await screen.findByText("No image models found")).toBeInTheDocument();
    });

    it("shows a plain empty message with no discovery hint for a capability without a heuristic entry", async () => {
        setModels([chatModelGpt4o]);
        const user = userEvent.setup();
        renderWithClient(
            <ModalityMultiModelSelector capability="unknown-modality" value={[]} onChange={vi.fn()} />
        );
        await user.click(trigger());
        expect(await screen.findByText("No unknown-modality models found")).toBeInTheDocument();
        expect(screen.queryByText(/discovery succeeded/)).not.toBeInTheDocument();
    });

    it("shows the discovery hint alongside the empty message for a capability with a heuristic entry", async () => {
        setModels([chatModelGpt4o]);
        const user = userEvent.setup();
        renderWithClient(<ModalityMultiModelSelector capability="image" value={[]} onChange={vi.fn()} />);
        await user.click(trigger());
        expect(await screen.findByText("No image models found")).toBeInTheDocument();
        expect(screen.getByText(/discovery succeeded/)).toBeInTheDocument();
    });

    it("resets the search query to empty when the dropdown is closed and reopened", async () => {
        setModels(DEFAULT_CATALOG);
        const user = userEvent.setup();
        renderWithClient(<ModalityMultiModelSelector capability="image" value={[]} onChange={vi.fn()} />);
        await user.click(trigger());
        const search = await screen.findByPlaceholderText("Search image models…");
        await user.type(search, "stable");
        expect(screen.queryByText("dall-e-3")).not.toBeInTheDocument();

        await user.click(trigger()); // close
        await user.click(trigger()); // reopen
        const reopenedSearch = await screen.findByPlaceholderText("Search image models…");
        expect(reopenedSearch).toHaveValue("");
        expect(screen.getByText("dall-e-3")).toBeInTheDocument();
    });
});

describe("ModalityMultiModelSelector — selection toggling", () => {
    it("adds an unselected model to the selection when below the cap", async () => {
        setModels(DEFAULT_CATALOG);
        const user = userEvent.setup();
        const onChange = vi.fn();
        renderWithClient(
            <ModalityMultiModelSelector capability="image" value={["dall-e-3"]} onChange={onChange} />
        );
        await user.click(trigger());
        const content = popoverContent() as HTMLElement;
        await user.click(within(content).getByText("stable-diffusion-xl"));
        expect(onChange).toHaveBeenCalledWith(["dall-e-3", "stable-diffusion-xl"]);
    });

    it("removes an already-selected model from the selection", async () => {
        setModels(DEFAULT_CATALOG);
        const user = userEvent.setup();
        const onChange = vi.fn();
        renderWithClient(
            <ModalityMultiModelSelector
                capability="image"
                value={["dall-e-3", "stable-diffusion-xl"]}
                onChange={onChange}
            />
        );
        await user.click(trigger());
        const content = popoverContent() as HTMLElement;
        await user.click(within(content).getByText("dall-e-3"));
        expect(onChange).toHaveBeenCalledWith(["stable-diffusion-xl"]);
    });

    it("does not close the dropdown after a pick", async () => {
        setModels(DEFAULT_CATALOG);
        const user = userEvent.setup();
        renderWithClient(
            <ModalityMultiModelSelector capability="image" value={["dall-e-3"]} onChange={vi.fn()} />
        );
        await user.click(trigger());
        const content = popoverContent() as HTMLElement;
        await user.click(within(content).getByText("stable-diffusion-xl"));
        expect(screen.getByPlaceholderText("Search image models…")).toBeInTheDocument();
    });

    it("disables unselected rows once the selection reaches maxModels, and a click on one is a no-op", async () => {
        setModels(DEFAULT_CATALOG);
        const user = userEvent.setup();
        const onChange = vi.fn();
        renderWithClient(
            <ModalityMultiModelSelector
                capability="image"
                value={["dall-e-3", "stable-diffusion-xl"]}
                onChange={onChange}
                maxModels={2}
            />
        );
        await user.click(trigger());
        const content = popoverContent() as HTMLElement;
        const unselectedRow = within(content).getByText("gpt-image-1").closest("button") as HTMLElement;
        expect(unselectedRow).toBeDisabled();
        expect(unselectedRow).toHaveClass("opacity-50", "cursor-not-allowed");
        fireEvent.click(unselectedRow);
        expect(onChange).not.toHaveBeenCalled();
    });

    it("keeps an already-selected row enabled at the cap, and clicking it still removes it", async () => {
        setModels(DEFAULT_CATALOG);
        const user = userEvent.setup();
        const onChange = vi.fn();
        renderWithClient(
            <ModalityMultiModelSelector
                capability="image"
                value={["dall-e-3", "stable-diffusion-xl"]}
                onChange={onChange}
                maxModels={2}
            />
        );
        await user.click(trigger());
        const content = popoverContent() as HTMLElement;
        const selectedRow = within(content).getByText("dall-e-3").closest("button") as HTMLElement;
        expect(selectedRow).not.toBeDisabled();
        await user.click(selectedRow);
        expect(onChange).toHaveBeenCalledWith(["stable-diffusion-xl"]);
    });

    it("shows the max-models message once the cap is reached", async () => {
        setModels(DEFAULT_CATALOG);
        const user = userEvent.setup();
        renderWithClient(
            <ModalityMultiModelSelector
                capability="image"
                value={["dall-e-3", "stable-diffusion-xl"]}
                onChange={vi.fn()}
                maxModels={2}
            />
        );
        await user.click(trigger());
        expect(await screen.findByText("Max 2 models. Remove one to add more.")).toBeInTheDocument();
    });

    it("hides the max-models message below the cap", async () => {
        setModels(DEFAULT_CATALOG);
        const user = userEvent.setup();
        renderWithClient(
            <ModalityMultiModelSelector
                capability="image"
                value={["dall-e-3"]}
                onChange={vi.fn()}
                maxModels={2}
            />
        );
        await user.click(trigger());
        await screen.findByPlaceholderText("Search image models…");
        expect(screen.queryByText(/Remove one to add more/)).not.toBeInTheDocument();
    });

    it("defaults maxModels to 6 when not provided (no cap message with 3 selections)", async () => {
        setModels(DEFAULT_CATALOG);
        const user = userEvent.setup();
        renderWithClient(
            <ModalityMultiModelSelector
                capability="image"
                value={["dall-e-3", "stable-diffusion-xl", "gpt-image-1"]}
                onChange={vi.fn()}
            />
        );
        await user.click(trigger());
        await screen.findByPlaceholderText("Search image models…");
        expect(screen.queryByText(/Remove one to add more/)).not.toBeInTheDocument();
    });
});

describe("ModalityMultiModelSelector — selected chips", () => {
    it("renders no chips when the selection is empty", () => {
        setModels(DEFAULT_CATALOG);
        renderWithClient(<ModalityMultiModelSelector capability="image" value={[]} onChange={vi.fn()} />);
        expect(screen.queryByRole("button", { name: /^Remove /i })).not.toBeInTheDocument();
    });

    it("renders a plain chip (icon + name, no stale tag) for a valid, enabled, matching selection", () => {
        setModels(DEFAULT_CATALOG);
        renderWithClient(
            <ModalityMultiModelSelector capability="image" value={["dall-e-3"]} onChange={vi.fn()} />
        );
        const chip = screen.getByText("dall-e-3").closest("[title]") as HTMLElement;
        expect(chip).toHaveAttribute("title", "dall-e-3");
        expect(within(chip).queryByText(/unavailable|missing/)).not.toBeInTheDocument();
        expect(document.querySelector('img[src="/providers/openai.svg"]')).toBeInTheDocument();
        expect(removeButton("dall-e-3")).toBeInTheDocument();
    });

    it("renders a 'missing' chip for a selected name absent from the catalog", () => {
        setModels(DEFAULT_CATALOG);
        renderWithClient(
            <ModalityMultiModelSelector capability="image" value={["deleted-model"]} onChange={vi.fn()} />
        );
        const chip = screen.getByText("deleted-model").closest("[title]") as HTMLElement;
        expect(chip).toHaveAttribute("title", "deleted-model (missing)");
        expect(within(chip).getByText("(missing)")).toBeInTheDocument();
        expect(screen.getByText("deleted-model")).toHaveClass("line-through");
    });

    it("renders an 'unavailable' chip for a selected model that's been disabled", () => {
        setModels(DEFAULT_CATALOG);
        renderWithClient(
            <ModalityMultiModelSelector capability="image" value={["disabled-image-model"]} onChange={vi.fn()} />
        );
        const chip = screen.getByText("disabled-image-model").closest("[title]") as HTMLElement;
        expect(chip).toHaveAttribute("title", "disabled-image-model (unavailable)");
        expect(within(chip).getByText("(unavailable)")).toBeInTheDocument();
    });

    it("renders an 'unavailable' chip for a selected model that no longer matches the capability", () => {
        setModels(DEFAULT_CATALOG);
        renderWithClient(
            <ModalityMultiModelSelector capability="image" value={["gpt-4o"]} onChange={vi.fn()} />
        );
        const chip = screen.getByText("gpt-4o").closest("[title]") as HTMLElement;
        expect(chip).toHaveAttribute("title", "gpt-4o (unavailable)");
    });

    it("removes the corresponding model when a chip's remove (X) button is clicked", async () => {
        setModels(DEFAULT_CATALOG);
        const user = userEvent.setup();
        const onChange = vi.fn();
        renderWithClient(
            <ModalityMultiModelSelector
                capability="image"
                value={["dall-e-3", "stable-diffusion-xl"]}
                onChange={onChange}
            />
        );
        await user.click(removeButton("dall-e-3"));
        expect(onChange).toHaveBeenCalledWith(["stable-diffusion-xl"]);
    });

    it("renders multiple chips in selection order", () => {
        setModels(DEFAULT_CATALOG);
        renderWithClient(
            <ModalityMultiModelSelector
                capability="image"
                value={["dall-e-3", "stable-diffusion-xl", "gpt-image-1"]}
                onChange={vi.fn()}
            />
        );
        expect(removeButton("dall-e-3")).toBeInTheDocument();
        expect(removeButton("stable-diffusion-xl")).toBeInTheDocument();
        expect(removeButton("gpt-image-1")).toBeInTheDocument();
    });

    it("renders a non-stale chip with the fallback provider glyph when the model's provider is null", () => {
        setModels([...DEFAULT_CATALOG, imageModelSparse]);
        renderWithClient(
            <ModalityMultiModelSelector capability="image" value={["sparse-image-model"]} onChange={vi.fn()} />
        );
        const chip = screen.getByText("sparse-image-model").closest("[title]") as HTMLElement;
        expect(chip).toHaveAttribute("title", "sparse-image-model");
        expect(within(chip).queryByText(/unavailable|missing/)).not.toBeInTheDocument();
    });

    it("renders no chips while the catalog is still loading, even with a persisted selection", () => {
        setModels(undefined, { isLoading: true });
        renderWithClient(
            <ModalityMultiModelSelector capability="image" value={["dall-e-3"]} onChange={vi.fn()} />
        );
        expect(screen.queryByRole("button", { name: "Remove dall-e-3" })).not.toBeInTheDocument();
    });
});
