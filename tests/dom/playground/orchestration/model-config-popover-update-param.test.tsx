// Isolated regression test for components/playground/model-config-popover.tsx
// — the `updateParam` half of bug #5 (see the sibling
// model-config-popover.test.tsx for full context and the `toggleParam`
// half). This assertion MUST live in its own file: React only logs the
// "Cannot update a component while rendering a different component"
// warning once per component-pair for the lifetime of its module
// registry, and Vitest gives each test file a fresh one (default
// `isolate: true`), so this is the only way to independently prove that
// `updateParam` (not just `toggleParam`) no longer calls `onConfigChange`
// from inside the `setLocalConfig` updater.
import * as React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithClient } from "../_render";
import { ModelConfigPopover, type ModelConfig } from "@/components/playground/model-config-popover";

/** Stand-in for a real caller (e.g. `model-chips-with-config.tsx`): owns
 *  its own config state and re-renders itself whenever `onConfigChange`
 *  fires — a no-op `vi.fn()` can never reproduce the "update during
 *  render" warning since it never itself touches React state. */
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

describe("ModelConfigPopover.updateParam — setState-during-render regression (bug #5)", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("updating a param's numeric value does not trigger React's 'update during render' warning, and notifies the parent", async () => {
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        const user = userEvent.setup();
        renderWithClient(<Harness initialConfig={{ maxTokens: 4096 }} />);

        await user.click(screen.getByText("gpt-4o").closest("button") as HTMLElement);
        await screen.findByText("Temperature");

        const input = within(screen.getByText("Max Tokens").closest(".group") as HTMLElement).getByRole("spinbutton");
        // A single atomic `fireEvent.change` (rather than `clear` + `type`)
        // — this input's `onChange` no-ops on an unparsable/out-of-range
        // value, so a multi-keystroke `clear()` + `type()` round-trip
        // would otherwise re-commit stale digits mid-sequence.
        fireEvent.change(input, { target: { value: "2048" } });

        const warned = errorSpy.mock.calls.some((args) =>
            args.some((a) => typeof a === "string" && a.includes("Cannot update a component"))
        );
        expect(warned).toBe(false);
        expect(screen.getByTestId("observed-config").textContent).toBe(JSON.stringify({ maxTokens: 2048 }));
    });
});
