// Tests for components/playground/modality-model-selector.tsx
// (ModalitySingleModelSelector) — the single-pick model selector shared
// by the image / video / speech / transcription playgrounds.
//
// Unlike components/playground/model-selector.tsx (a hand-rolled portal),
// this component uses Radix `Popover`, so it's driven with `userEvent`
// clicks and queried via `data-slot="popover-trigger"` /
// `data-slot="popover-content"` to disambiguate the trigger from dropdown
// rows once a model name appears in both places.
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";

import { renderWithClient } from "./_render";
import { makeQuery } from "./_mocks";
import {
    chatModelGpt4o,
    heuristicImageModel,
    imageModelDalle3,
    imageModelDisabled,
    imageModelSdxl,
    imageModelSparse,
} from "./_fixtures";

vi.mock("@/lib/api/models", () => ({
    models: { useList: vi.fn() },
}));

import { models } from "@/lib/api/models";
import { ModalitySingleModelSelector } from "@/components/playground/modality-model-selector";

function setModels(list: unknown[] | undefined, overrides: Record<string, unknown> = {}) {
    vi.mocked(models.useList).mockReturnValue(makeQuery({ data: list as never, ...overrides }));
}

function trigger(): HTMLElement {
    return document.querySelector('[data-slot="popover-trigger"]') as HTMLElement;
}

function popoverContent(): HTMLElement | null {
    return document.querySelector('[data-slot="popover-content"]');
}

const DEFAULT_CATALOG = [imageModelDalle3, imageModelSdxl, imageModelDisabled, chatModelGpt4o];

describe("ModalitySingleModelSelector — trigger placeholder / loading", () => {
    it("shows the default placeholder when no value is selected", () => {
        setModels(DEFAULT_CATALOG);
        renderWithClient(<ModalitySingleModelSelector capability="image" value={null} onChange={vi.fn()} />);
        expect(screen.getByText("Select a model")).toBeInTheDocument();
    });

    it("shows a caller-supplied placeholder when provided", () => {
        setModels(DEFAULT_CATALOG);
        renderWithClient(
            <ModalitySingleModelSelector
                capability="image"
                value={null}
                onChange={vi.fn()}
                placeholder="Choose one"
            />
        );
        expect(screen.getByText("Choose one")).toBeInTheDocument();
        expect(screen.queryByText("Select a model")).not.toBeInTheDocument();
    });

    it("disables the trigger and shows 'Loading…' while the catalog is loading", () => {
        setModels(undefined, { isLoading: true });
        renderWithClient(<ModalitySingleModelSelector capability="image" value={null} onChange={vi.fn()} />);
        expect(trigger()).toBeDisabled();
        expect(screen.getByText("Loading…")).toBeInTheDocument();
    });

    it("applies a caller-supplied className to the trigger", () => {
        setModels(DEFAULT_CATALOG);
        renderWithClient(
            <ModalitySingleModelSelector
                capability="image"
                value={null}
                onChange={vi.fn()}
                className="my-extra-marker"
            />
        );
        expect(trigger()).toHaveClass("my-extra-marker");
    });
});

describe("ModalitySingleModelSelector — trigger selected-value rendering", () => {
    it("shows the provider icon + name for a valid, enabled, capability-matching selection", () => {
        setModels(DEFAULT_CATALOG);
        renderWithClient(<ModalitySingleModelSelector capability="image" value="dall-e-3" onChange={vi.fn()} />);
        expect(within(trigger()).getByText("dall-e-3")).toBeInTheDocument();
        expect(screen.queryByText("(unavailable)")).not.toBeInTheDocument();
        expect(screen.queryByText("(missing)")).not.toBeInTheDocument();
        expect(document.querySelector('img[src="/providers/openai.svg"]')).toBeInTheDocument();
    });

    it("flags a disabled model as '(unavailable)' with strike-through styling", () => {
        setModels(DEFAULT_CATALOG);
        renderWithClient(
            <ModalitySingleModelSelector capability="image" value="disabled-image-model" onChange={vi.fn()} />
        );
        expect(within(trigger()).getByText("disabled-image-model")).toHaveClass("line-through");
        expect(within(trigger()).getByText("(unavailable)")).toBeInTheDocument();
    });

    it("flags a capability-mismatched model (no heuristic match either) as '(unavailable)'", () => {
        setModels(DEFAULT_CATALOG);
        renderWithClient(<ModalitySingleModelSelector capability="image" value="gpt-4o" onChange={vi.fn()} />);
        expect(within(trigger()).getByText("gpt-4o")).toBeInTheDocument();
        expect(within(trigger()).getByText("(unavailable)")).toBeInTheDocument();
    });

    it("flags a value with no matching catalog entry as '(missing)'", () => {
        setModels(DEFAULT_CATALOG);
        renderWithClient(
            <ModalitySingleModelSelector capability="image" value="deleted-model" onChange={vi.fn()} />
        );
        expect(within(trigger()).getByText("deleted-model")).toBeInTheDocument();
        expect(within(trigger()).getByText("(missing)")).toBeInTheDocument();
    });

    // Regression test for the fix to components/playground/modality-model-selector.tsx:
    // `catalogLoaded` (`Array.isArray(data)`) now gates the "(missing)"
    // branch, so a persisted `value` no longer gets misdiagnosed as
    // missing merely because the catalog hasn't arrived yet — it renders
    // plainly (muted, not destructive) until there's an actual catalog to
    // check it against.
    it("shows a persisted value in muted styling (not destructive) while the catalog is still loading", () => {
        setModels(undefined, { isLoading: true });
        renderWithClient(
            <ModalitySingleModelSelector capability="image" value="dall-e-3" onChange={vi.fn()} />
        );
        expect(trigger()).toBeDisabled();
        expect(screen.queryByText("(missing)")).not.toBeInTheDocument();
        expect(screen.queryByText("(unavailable)")).not.toBeInTheDocument();
        const nameEl = within(trigger()).getByText("dall-e-3");
        expect(nameEl).toHaveClass("text-muted-foreground");
        expect(nameEl).not.toHaveClass("text-destructive");
    });

    // Complementary branch: once the catalog *has* loaded, a value that
    // genuinely isn't in it must still be flagged destructive — the fix
    // only defers the check, it doesn't suppress it.
    it("still flags a value as '(missing)' once the catalog has loaded and it genuinely isn't in it", () => {
        setModels(DEFAULT_CATALOG); // loaded, catalogLoaded === true
        renderWithClient(
            <ModalitySingleModelSelector capability="image" value="never-existed" onChange={vi.fn()} />
        );
        const nameEl = within(trigger()).getByText("never-existed");
        expect(nameEl).toHaveClass("text-destructive");
        expect(within(trigger()).getByText("(missing)")).toBeInTheDocument();
    });
});

describe("ModalitySingleModelSelector — dropdown catalog + filtering", () => {
    it("opens the dropdown with a capability-scoped search placeholder", async () => {
        setModels(DEFAULT_CATALOG);
        const user = userEvent.setup();
        renderWithClient(<ModalitySingleModelSelector capability="image" value={null} onChange={vi.fn()} />);
        await user.click(trigger());
        expect(await screen.findByPlaceholderText("Search image models…")).toBeInTheDocument();
    });

    it("lists only enabled, capability-matching models, excluding disabled and mismatched ones", async () => {
        setModels(DEFAULT_CATALOG);
        const user = userEvent.setup();
        renderWithClient(<ModalitySingleModelSelector capability="image" value={null} onChange={vi.fn()} />);
        await user.click(trigger());
        await screen.findByPlaceholderText("Search image models…");
        const content = popoverContent() as HTMLElement;
        expect(within(content).getByText("dall-e-3")).toBeInTheDocument();
        expect(within(content).getByText("stable-diffusion-xl")).toBeInTheDocument();
        expect(within(content).queryByText("disabled-image-model")).not.toBeInTheDocument();
        expect(within(content).queryByText("gpt-4o")).not.toBeInTheDocument();
    });

    it("includes a model matched only via the name heuristic, tagged with its real type", async () => {
        setModels([imageModelDalle3, heuristicImageModel]);
        const user = userEvent.setup();
        renderWithClient(<ModalitySingleModelSelector capability="image" value={null} onChange={vi.fn()} />);
        await user.click(trigger());
        const content = popoverContent() as HTMLElement;
        const row = (await within(content).findByText("flux-pro")).closest("button") as HTMLElement;
        expect(within(row).getByText("chat")).toBeInTheDocument();
    });

    it("does not show a type badge for a model whose type matches the capability", async () => {
        setModels(DEFAULT_CATALOG);
        const user = userEvent.setup();
        renderWithClient(<ModalitySingleModelSelector capability="image" value={null} onChange={vi.fn()} />);
        await user.click(trigger());
        const content = popoverContent() as HTMLElement;
        const row = (await within(content).findByText("dall-e-3")).closest("button") as HTMLElement;
        expect(within(row).queryByText("image")).not.toBeInTheDocument();
    });

    it("filters the list by a case-insensitive name substring", async () => {
        setModels(DEFAULT_CATALOG);
        const user = userEvent.setup();
        renderWithClient(<ModalitySingleModelSelector capability="image" value={null} onChange={vi.fn()} />);
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
        renderWithClient(<ModalitySingleModelSelector capability="image" value={null} onChange={vi.fn()} />);
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
        renderWithClient(<ModalitySingleModelSelector capability="image" value={null} onChange={vi.fn()} />);
        await user.click(trigger());
        const search = await screen.findByPlaceholderText("Search image models…");
        await user.type(search, "sparse");
        const content = popoverContent() as HTMLElement;
        expect(within(content).getByText("sparse-image-model")).toBeInTheDocument();
        expect(within(content).queryByText("dall-e-3")).not.toBeInTheDocument();
    });

    it("shows a plain empty message with no discovery hint for a capability without a heuristic entry", async () => {
        setModels([chatModelGpt4o]);
        const user = userEvent.setup();
        renderWithClient(
            <ModalitySingleModelSelector capability="unknown-modality" value={null} onChange={vi.fn()} />
        );
        await user.click(trigger());
        expect(await screen.findByText("No unknown-modality models found")).toBeInTheDocument();
        expect(screen.queryByText(/discovery succeeded/)).not.toBeInTheDocument();
    });

    it("shows the discovery hint alongside the empty message for a capability with a heuristic entry", async () => {
        setModels([chatModelGpt4o]);
        const user = userEvent.setup();
        renderWithClient(<ModalitySingleModelSelector capability="image" value={null} onChange={vi.fn()} />);
        await user.click(trigger());
        expect(await screen.findByText("No image models found")).toBeInTheDocument();
        expect(screen.getByText(/discovery succeeded/)).toBeInTheDocument();
    });

    it("shows 'Loading…' (and no hint) instead of the empty-catalog message once a background refetch flips isLoading on", async () => {
        setModels(DEFAULT_CATALOG);
        const user = userEvent.setup();
        const { rerender, queryClient } = renderWithClient(
            <ModalitySingleModelSelector capability="image" value={null} onChange={vi.fn()} />
        );
        await user.click(trigger());
        await screen.findByPlaceholderText("Search image models…");

        setModels(undefined, { isLoading: true });
        rerender(
            <QueryClientProvider client={queryClient}>
                <ModalitySingleModelSelector capability="image" value={null} onChange={vi.fn()} />
            </QueryClientProvider>
        );
        const content = popoverContent() as HTMLElement;
        expect(within(content).getByText("Loading…")).toBeInTheDocument();
        expect(within(content).queryByText("dall-e-3")).not.toBeInTheDocument();
        expect(within(content).queryByText(/discovery succeeded/)).not.toBeInTheDocument();
    });

    it("resets the search query to empty when the dropdown is closed and reopened", async () => {
        setModels(DEFAULT_CATALOG);
        const user = userEvent.setup();
        renderWithClient(<ModalitySingleModelSelector capability="image" value={null} onChange={vi.fn()} />);
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

describe("ModalitySingleModelSelector — selecting a model", () => {
    it("calls onChange with the model name and closes the dropdown", async () => {
        setModels(DEFAULT_CATALOG);
        const user = userEvent.setup();
        const onChange = vi.fn();
        renderWithClient(<ModalitySingleModelSelector capability="image" value={null} onChange={onChange} />);
        await user.click(trigger());
        const content = popoverContent() as HTMLElement;
        await user.click(within(content).getByText("dall-e-3"));
        expect(onChange).toHaveBeenCalledWith("dall-e-3");
        expect(screen.queryByPlaceholderText("Search image models…")).not.toBeInTheDocument();
    });

    it("highlights the row matching the current value", async () => {
        setModels(DEFAULT_CATALOG);
        const user = userEvent.setup();
        renderWithClient(<ModalitySingleModelSelector capability="image" value="dall-e-3" onChange={vi.fn()} />);
        await user.click(trigger());
        const content = popoverContent() as HTMLElement;
        const selectedRow = within(content).getByText("dall-e-3").closest("button") as HTMLElement;
        const otherRow = within(content).getByText("stable-diffusion-xl").closest("button") as HTMLElement;
        expect(selectedRow).toHaveClass("bg-accent");
        expect(otherRow).not.toHaveClass("bg-accent");
    });
});
