// Tests for components/playground/model-config-popover.tsx (ModelConfigPopover).
//
// The popover is a hand-rolled portal (not Radix), so it's driven with
// plain userEvent clicks + document.body queries (portal content renders
// as a sibling of the RTL container, both under document.body).
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
    ModelConfigPopover,
    DEFAULT_MODEL_CONFIG,
    type ModelConfig,
} from "@/components/playground/model-config-popover";

afterEach(() => {
    cleanup();
});

function chipButton(modelId: string): HTMLElement {
    return screen.getByText(modelId).closest("button") as HTMLElement;
}

/** ParamRow/ReasoningRow wrapper — the outer `.group` div ancestor of the
 *  row's label span, distinct from the chip trigger button (which also
 *  carries a `.group` class, but lives outside the label's ancestry). */
function rowByLabel(label: string): HTMLElement {
    return screen.getByText(label).closest(".group") as HTMLElement;
}

function toggleHeader(label: string): HTMLElement {
    return rowByLabel(label).querySelector(".cursor-pointer") as HTMLElement;
}

describe("ModelConfigPopover — chip appearance", () => {
    it("renders a plain (non-custom) chip when config is empty", () => {
        render(
            <ModelConfigPopover
                modelId="gpt-4o"
                config={DEFAULT_MODEL_CONFIG}
                onConfigChange={vi.fn()}
            />
        );
        const btn = chipButton("gpt-4o");
        expect(btn).not.toHaveClass("bg-primary/10");
        expect(within(btn).queryByText(/^\d+$/)).not.toBeInTheDocument();
    });

    it("renders a primary-styled chip with a count badge when config has custom values", () => {
        render(
            <ModelConfigPopover
                modelId="gpt-4o"
                config={{ temperature: 0.5, topP: 0.9 }}
                onConfigChange={vi.fn()}
            />
        );
        const btn = chipButton("gpt-4o");
        expect(btn).toHaveClass("bg-primary/10");
        expect(within(btn).getByText("2")).toBeInTheDocument();
    });

    it("renders the remove (X) affordance when canRemove and onRemove are both set", () => {
        const onRemove = vi.fn();
        render(
            <ModelConfigPopover
                modelId="gpt-4o"
                config={DEFAULT_MODEL_CONFIG}
                onConfigChange={vi.fn()}
                onRemove={onRemove}
                canRemove
            />
        );
        expect(document.querySelector("svg.lucide-x")).toBeInTheDocument();
    });

    it("omits the remove affordance when canRemove is false", () => {
        render(
            <ModelConfigPopover
                modelId="gpt-4o"
                config={DEFAULT_MODEL_CONFIG}
                onConfigChange={vi.fn()}
                onRemove={vi.fn()}
                canRemove={false}
            />
        );
        expect(document.querySelector("svg.lucide-x")).not.toBeInTheDocument();
    });

    it("omits the remove affordance when onRemove is not provided", () => {
        render(
            <ModelConfigPopover modelId="gpt-4o" config={DEFAULT_MODEL_CONFIG} onConfigChange={vi.fn()} />
        );
        expect(document.querySelector("svg.lucide-x")).not.toBeInTheDocument();
    });

    it("calls onRemove without opening the popover when the X is clicked", async () => {
        const user = userEvent.setup();
        const onRemove = vi.fn();
        render(
            <ModelConfigPopover
                modelId="gpt-4o"
                config={DEFAULT_MODEL_CONFIG}
                onConfigChange={vi.fn()}
                onRemove={onRemove}
            />
        );
        await user.click(document.querySelector("svg.lucide-x") as Element);
        expect(onRemove).toHaveBeenCalledWith("gpt-4o");
        expect(screen.queryByText("Reset")).not.toBeInTheDocument();
    });

    it("renders a destructive 'missing' chip with the stale tag and title", () => {
        render(
            <ModelConfigPopover
                modelId="deleted-model"
                config={DEFAULT_MODEL_CONFIG}
                onConfigChange={vi.fn()}
                stale="missing"
            />
        );
        const btn = chipButton("deleted-model");
        expect(btn).toHaveClass("bg-destructive/10");
        expect(btn).toHaveAttribute("title", "deleted-model (missing) — remove and re-pick");
        expect(screen.getByText("(missing)")).toBeInTheDocument();
        expect(screen.getByText("deleted-model")).toHaveClass("line-through");
    });

    it("renders a destructive 'unavailable' chip with the stale tag and title", () => {
        render(
            <ModelConfigPopover
                modelId="old-model"
                config={DEFAULT_MODEL_CONFIG}
                onConfigChange={vi.fn()}
                stale="unavailable"
            />
        );
        const btn = chipButton("old-model");
        expect(btn).toHaveAttribute("title", "old-model (unavailable) — remove and re-pick");
        expect(screen.getByText("(unavailable)")).toBeInTheDocument();
    });

    it("defaults to the openai provider icon when provider is omitted", () => {
        render(
            <ModelConfigPopover modelId="gpt-4o" config={DEFAULT_MODEL_CONFIG} onConfigChange={vi.fn()} />
        );
        const img = document.querySelector('img[src="/providers/openai.svg"]');
        expect(img).toBeInTheDocument();
    });

    it("falls back to initials for an unknown provider", () => {
        render(
            <ModelConfigPopover
                modelId="custom-model"
                provider="unknownprov"
                config={DEFAULT_MODEL_CONFIG}
                onConfigChange={vi.fn()}
            />
        );
        expect(screen.getByText("UN")).toBeInTheDocument();
    });
});

describe("ModelConfigPopover — open/close + reset", () => {
    it("opens the popover with the header, model id and Reset button on chip click", async () => {
        const user = userEvent.setup();
        render(
            <ModelConfigPopover modelId="gpt-4o" config={DEFAULT_MODEL_CONFIG} onConfigChange={vi.fn()} />
        );
        await user.click(chipButton("gpt-4o"));
        expect(await screen.findByRole("button", { name: /reset/i })).toBeInTheDocument();
        expect(screen.getByText("Temperature")).toBeInTheDocument();
    });

    it("disables Reset when the incoming config has no custom values", async () => {
        const user = userEvent.setup();
        render(
            <ModelConfigPopover modelId="gpt-4o" config={DEFAULT_MODEL_CONFIG} onConfigChange={vi.fn()} />
        );
        await user.click(chipButton("gpt-4o"));
        expect(await screen.findByRole("button", { name: /reset/i })).toBeDisabled();
    });

    it("enables Reset when the incoming config has custom values, and shows the enabled-count badge", async () => {
        const user = userEvent.setup();
        render(
            <ModelConfigPopover
                modelId="gpt-4o"
                config={{ temperature: 0.4 }}
                onConfigChange={vi.fn()}
            />
        );
        await user.click(chipButton("gpt-4o"));
        const resetBtn = await screen.findByRole("button", { name: /reset/i });
        expect(resetBtn).toBeEnabled();
        // Header badge next to the model id reflects localConfig, seeded
        // from `config` on open. Scope to the popover container (a
        // `div[style]` ancestor of Reset) since the chip trigger renders
        // the same model id text outside the popover.
        const popover = resetBtn.closest("div[style]") as HTMLElement;
        expect(within(popover).getByText("1")).toBeInTheDocument();
    });

    it("clicking Reset clears every param back to Auto and calls onConfigChange({})", async () => {
        const user = userEvent.setup();
        const onConfigChange = vi.fn();
        render(
            <ModelConfigPopover
                modelId="gpt-4o"
                config={{ temperature: 0.4, maxTokens: 2048 }}
                onConfigChange={onConfigChange}
            />
        );
        await user.click(chipButton("gpt-4o"));
        await user.click(await screen.findByRole("button", { name: /reset/i }));
        expect(onConfigChange).toHaveBeenCalledWith("gpt-4o", {});
        // Both rows now read "Auto".
        expect(within(rowByLabel("Temperature")).getByText("Auto")).toBeInTheDocument();
        expect(within(rowByLabel("Max Tokens")).getByText("Auto")).toBeInTheDocument();
    });

    it("closes the popover when clicking outside", async () => {
        const user = userEvent.setup();
        render(
            <ModelConfigPopover modelId="gpt-4o" config={DEFAULT_MODEL_CONFIG} onConfigChange={vi.fn()} />
        );
        await user.click(chipButton("gpt-4o"));
        expect(await screen.findByText("Temperature")).toBeInTheDocument();
        fireEvent.mouseDown(document.body);
        expect(screen.queryByText("Temperature")).not.toBeInTheDocument();
    });

    it("re-syncs localConfig from the latest config prop each time it reopens", async () => {
        const user = userEvent.setup();
        const onConfigChange = vi.fn();
        const { rerender } = render(
            <ModelConfigPopover modelId="gpt-4o" config={{}} onConfigChange={onConfigChange} />
        );
        // Capture the trigger once — after opening, both the chip and the
        // popover header render the text "gpt-4o", so re-querying by text
        // would be ambiguous.
        const chip = chipButton("gpt-4o");
        await user.click(chip);
        expect(within(rowByLabel("Temperature")).getByText("Auto")).toBeInTheDocument();
        await user.click(chip); // close

        rerender(
            <ModelConfigPopover modelId="gpt-4o" config={{ temperature: 0.8 }} onConfigChange={onConfigChange} />
        );
        await user.click(chip); // reopen
        expect(within(rowByLabel("Temperature")).getByText("0.8")).toBeInTheDocument();
    });
});

describe("ModelConfigPopover — numeric param rows (toggle + value)", () => {
    it.each([
        ["Temperature", "temperature", 1, 0.5],
        ["Top P", "topP", 1, 0.7],
        ["Frequency Penalty", "frequencyPenalty", 0, 1.5],
        ["Presence Penalty", "presencePenalty", 0, -1.5],
    ] as const)("toggles %s on with its default value, edits it, then off again", async (label, key, defaultValue, newValue) => {
        const user = userEvent.setup();
        const onConfigChange = vi.fn();
        render(
            <ModelConfigPopover modelId="gpt-4o" config={{}} onConfigChange={onConfigChange} />
        );
        await user.click(chipButton("gpt-4o"));

        await user.click(toggleHeader(label));
        expect(onConfigChange).toHaveBeenLastCalledWith("gpt-4o", { [key]: defaultValue });
        expect(within(rowByLabel(label)).getByRole("spinbutton")).toHaveValue(defaultValue);

        const input = within(rowByLabel(label)).getByRole("spinbutton");
        fireEvent.change(input, { target: { value: String(newValue) } });
        expect(onConfigChange).toHaveBeenLastCalledWith("gpt-4o", { [key]: newValue });

        await user.click(toggleHeader(label));
        expect(onConfigChange).toHaveBeenLastCalledWith("gpt-4o", {});
    });

    it("updates temperature through the paired number input within bounds", async () => {
        const user = userEvent.setup();
        const onConfigChange = vi.fn();
        render(<ModelConfigPopover modelId="gpt-4o" config={{}} onConfigChange={onConfigChange} />);
        await user.click(chipButton("gpt-4o"));
        await user.click(toggleHeader("Temperature"));

        const input = within(rowByLabel("Temperature")).getByRole("spinbutton");
        fireEvent.change(input, { target: { value: "0.5" } });
        expect(onConfigChange).toHaveBeenLastCalledWith("gpt-4o", { temperature: 0.5 });
    });

    it("ignores an out-of-range temperature value (leaves the last valid value in place)", async () => {
        const user = userEvent.setup();
        const onConfigChange = vi.fn();
        render(<ModelConfigPopover modelId="gpt-4o" config={{}} onConfigChange={onConfigChange} />);
        await user.click(chipButton("gpt-4o"));
        await user.click(toggleHeader("Temperature"));
        onConfigChange.mockClear();

        const input = within(rowByLabel("Temperature")).getByRole("spinbutton");
        fireEvent.change(input, { target: { value: "5" } }); // max is 2
        expect(onConfigChange).not.toHaveBeenCalled();
    });

    it("updates temperature via the paired Slider's keyboard step interaction", async () => {
        const user = userEvent.setup();
        const onConfigChange = vi.fn();
        render(<ModelConfigPopover modelId="gpt-4o" config={{}} onConfigChange={onConfigChange} />);
        await user.click(chipButton("gpt-4o"));
        await user.click(toggleHeader("Temperature"));
        onConfigChange.mockClear();

        const thumb = within(rowByLabel("Temperature")).getByRole("slider");
        fireEvent.keyDown(thumb, { key: "ArrowRight" });
        expect(onConfigChange).toHaveBeenCalledWith("gpt-4o", { temperature: 1.1 });
    });

    it("toggles Max Tokens on (no slider) with its default, updates via the input, and rejects out-of-range", async () => {
        const user = userEvent.setup();
        const onConfigChange = vi.fn();
        render(<ModelConfigPopover modelId="gpt-4o" config={{}} onConfigChange={onConfigChange} />);
        await user.click(chipButton("gpt-4o"));

        await user.click(toggleHeader("Max Tokens"));
        expect(onConfigChange).toHaveBeenLastCalledWith("gpt-4o", { maxTokens: 4096 });

        const input = within(rowByLabel("Max Tokens")).getByRole("spinbutton");
        fireEvent.change(input, { target: { value: "8000" } });
        expect(onConfigChange).toHaveBeenLastCalledWith("gpt-4o", { maxTokens: 8000 });

        fireEvent.change(input, { target: { value: "0" } }); // min is 1
        expect(onConfigChange).toHaveBeenLastCalledWith("gpt-4o", { maxTokens: 8000 });
    });
});

describe("ModelConfigPopover — reasoning effort row", () => {
    it("toggles on with the 'medium' default, switches level, then toggles off", async () => {
        const user = userEvent.setup();
        const onConfigChange = vi.fn();
        render(<ModelConfigPopover modelId="gpt-4o" config={{}} onConfigChange={onConfigChange} />);
        await user.click(chipButton("gpt-4o"));

        await user.click(toggleHeader("Reasoning Effort"));
        expect(onConfigChange).toHaveBeenLastCalledWith("gpt-4o", { reasoningEffort: "medium" });

        await user.click(within(rowByLabel("Reasoning Effort")).getByRole("button", { name: "high" }));
        expect(onConfigChange).toHaveBeenLastCalledWith("gpt-4o", { reasoningEffort: "high" });

        await user.click(within(rowByLabel("Reasoning Effort")).getByRole("button", { name: "low" }));
        expect(onConfigChange).toHaveBeenLastCalledWith("gpt-4o", { reasoningEffort: "low" });

        await user.click(toggleHeader("Reasoning Effort"));
        expect(onConfigChange).toHaveBeenLastCalledWith("gpt-4o", {});
    });
});

describe("ModelConfigPopover — positioning branches", () => {
    let rectSpy: ReturnType<typeof vi.spyOn>;

    afterEach(() => {
        rectSpy?.mockRestore();
    });

    it("opens below, anchored left, with ample space", async () => {
        rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
            top: 10, left: 10, right: 60, bottom: 40, width: 50, height: 30, x: 10, y: 10, toJSON() {},
        } as DOMRect);
        const user = userEvent.setup();
        render(<ModelConfigPopover modelId="gpt-4o" config={{}} onConfigChange={vi.fn()} />);
        await user.click(chipButton("gpt-4o"));
        const label = await screen.findByText("Temperature");
        const popover = label.closest('div[style]') as HTMLElement;
        expect(popover.style.top).not.toBe("");
        expect(popover.style.bottom).toBe("");
        expect(popover.style.left).toBe("10px");
    });

    it("opens above and clamps left near the bottom-right corner", async () => {
        rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
            top: 700, left: 900, right: 950, bottom: 730, width: 50, height: 30, x: 900, y: 700, toJSON() {},
        } as DOMRect);
        const user = userEvent.setup();
        render(<ModelConfigPopover modelId="gpt-4o" config={{}} onConfigChange={vi.fn()} />);
        await user.click(chipButton("gpt-4o"));
        const label = await screen.findByText("Temperature");
        const popover = label.closest('div[style]') as HTMLElement;
        expect(popover.style.bottom).not.toBe("");
        expect(popover.style.top).toBe("");
        expect(popover.style.left).toBe("630px");
    });

    it("recalculates position on window resize/scroll without crashing", async () => {
        const user = userEvent.setup();
        render(<ModelConfigPopover modelId="gpt-4o" config={{}} onConfigChange={vi.fn()} />);
        await user.click(chipButton("gpt-4o"));
        await screen.findByText("Temperature");
        fireEvent.scroll(window);
        fireEvent(window, new Event("resize"));
        expect(screen.getByText("Temperature")).toBeInTheDocument();
    });
});

// Sanity check on the re-exported helpers (used by model-chips-with-config.tsx).
describe("re-exported helpers", () => {
    it("DEFAULT_MODEL_CONFIG is an empty object", () => {
        expect(DEFAULT_MODEL_CONFIG).toEqual({});
    });

    it("ModelConfig type export round-trips through a real value", () => {
        const cfg: ModelConfig = { temperature: 0.2 };
        expect(cfg.temperature).toBe(0.2);
    });
});
