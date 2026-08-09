// Regression coverage for components/playground/model-config-popover.tsx.
//
// Scope note: this component's general behaviour (rendering, position
// calculation, per-param rows, reset, remove, stale states, etc.) is
// already comprehensively covered by a sibling agent's
// tests/dom/playground-model/model-config-popover.test.tsx (not touched
// here — different ownership). This file exists ONLY to pin down a bug
// found + fixed in this session:
//
//   `toggleParam`/`updateParam` used to call `onConfigChange(modelId, ...)`
//   from *inside* the `setLocalConfig(prev => ...)` functional updater.
//   When the parent's `onConfigChange` itself updates React state (the
//   normal case — e.g. `model-chips-with-config.tsx` forwarding into a
//   Zustand store setter or its own `useState`), that inner call fires
//   *during* this component's own state commit, which triggers React's
//   "Cannot update a component while rendering a different component"
//   dev warning. A `vi.fn()` no-op `onConfigChange` can never reproduce
//   this — the harness below wires a *real* parent-owned `useState` so
//   the regression is actually exercised.
//
// Fixed by mirroring `handleReset`'s pre-existing (correct) pattern:
// compute the next config, call `setLocalConfig`, THEN call
// `onConfigChange` as a separate, sequential statement — never nested
// inside the updater.
//
// NOTE on test layout: React only logs the "Cannot update a component
// while rendering a different component" warning ONCE per component-pair
// per module registry (an internal, un-resettable `Set`) — a second
// occurrence in the *same* test file/process would be silently swallowed
// regardless of whether the code is actually fixed. Vitest gives each
// test *file* its own fresh module registry (default `isolate: true`),
// so the `updateParam` half of this regression lives in its own sibling
// file (`model-config-popover-update-param.test.tsx`) to guarantee it
// independently exercises the warning rather than riding on this file's
// dedup state.
import * as React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithClient } from "../_render";
import { ModelConfigPopover, type ModelConfig } from "@/components/playground/model-config-popover";

/** Stand-in for a real caller (e.g. `model-chips-with-config.tsx`): owns
 *  its own config state and re-renders itself whenever `onConfigChange`
 *  fires. This is the shape that actually reproduces the "update during
 *  render" warning if `onConfigChange` is invoked mid-commit. */
function Harness({ initialConfig = {} }: { initialConfig?: ModelConfig }) {
    const [config, setConfig] = React.useState<ModelConfig>(initialConfig);
    const onConfigChange = React.useCallback((_modelId: string, next: ModelConfig) => {
        setConfig(next);
    }, []);
    return (
        <div>
            <ModelConfigPopover modelId="gpt-4o" config={config} onConfigChange={onConfigChange} />
            <div data-testid="observed-config">{JSON.stringify(config)}</div>
        </div>
    );
}

function trigger(): HTMLElement {
    return screen.getByText("gpt-4o").closest("button") as HTMLElement;
}

function row(label: string): HTMLElement {
    return screen.getByText(label).closest(".group") as HTMLElement;
}

async function openPopover(user: ReturnType<typeof userEvent.setup>) {
    await user.click(trigger());
    await screen.findByText("Temperature");
}

/** True if any `console.error` call this test observed matches React's
 *  "setState on a different component during render" warning text. */
function sawUpdateDuringRenderWarning(spy: { mock: { calls: unknown[][] } }): boolean {
    return spy.mock.calls.some((args) =>
        args.some((a) => typeof a === "string" && a.includes("Cannot update a component"))
    );
}

describe("ModelConfigPopover — setState-during-render regression (bug #5)", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("toggling a param on does not trigger React's 'update during render' warning, and notifies the parent", async () => {
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        const user = userEvent.setup();
        renderWithClient(<Harness />);

        await openPopover(user);
        await user.click(within(row("Temperature")).getByText("Auto"));

        expect(sawUpdateDuringRenderWarning(errorSpy)).toBe(false);
        expect(screen.getByTestId("observed-config").textContent).toBe(JSON.stringify({ temperature: 1 }));
    });

    it("updating a param's numeric value also notifies the parent correctly (warning-freedom covered in the sibling isolated file)", async () => {
        const user = userEvent.setup();
        renderWithClient(<Harness initialConfig={{ maxTokens: 4096 }} />);

        await openPopover(user);
        const input = within(row("Max Tokens")).getByRole("spinbutton");
        // A single atomic `fireEvent.change` (rather than `clear` + `type`)
        // — this input's `onChange` no-ops on an unparsable/out-of-range
        // value, so a multi-keystroke `clear()` + `type()` round-trip
        // would otherwise re-commit stale digits mid-sequence.
        fireEvent.change(input, { target: { value: "2048" } });

        expect(screen.getByTestId("observed-config").textContent).toBe(JSON.stringify({ maxTokens: 2048 }));
    });

    it("toggling a param back off removes it from the parent's config (roundtrip)", async () => {
        const user = userEvent.setup();
        renderWithClient(<Harness initialConfig={{ topP: 0.9 }} />);

        await openPopover(user);
        await user.click(within(row("Top P")).getByText("0.9"));

        expect(screen.getByTestId("observed-config").textContent).toBe("{}");
    });

    it("reset clears all params via the same set-then-notify pattern", async () => {
        const user = userEvent.setup();
        renderWithClient(<Harness initialConfig={{ temperature: 0.5, topP: 0.8 }} />);

        await openPopover(user);
        await user.click(screen.getByRole("button", { name: /reset/i }));

        expect(screen.getByTestId("observed-config").textContent).toBe("{}");
    });
});
