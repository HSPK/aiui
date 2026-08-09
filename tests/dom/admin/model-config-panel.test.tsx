import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";

import { renderWithQuery } from "./_render";
import { modelOverride, modelDiscovered } from "./_fixtures";
import { ModelConfigPanel } from "@/components/models/model-config-panel";

// RTL's default text matcher collapses whitespace (including the newlines
// `JSON.stringify(x, null, 2)` produces), so multi-line <pre> blocks can't
// be found via `getByText` with an exact expected string. Compare raw
// `textContent` instead.
function preTexts(container: HTMLElement): string[] {
    return Array.from(container.querySelectorAll("pre")).map((el) => el.textContent ?? "");
}

describe("ModelConfigPanel", () => {
    it("shows 'empty' for the Provider block when providerDefaults is null", () => {
        renderWithQuery(<ModelConfigPanel model={modelOverride} providerDefaults={null} />);
        // Model block has default_params={temperature:0.7} (non-empty), so
        // only the Provider block should read "empty".
        expect(screen.getAllByText("empty")).toHaveLength(1);
    });

    it("renders the Model block's default_params as pretty JSON", () => {
        const { container } = renderWithQuery(<ModelConfigPanel model={modelOverride} providerDefaults={null} />);
        expect(preTexts(container)).toContain(JSON.stringify({ temperature: 0.7 }, null, 2));
    });

    it("renders the Effective block as the shallow merge of provider defaults + model defaults (model wins)", () => {
        const { container } = renderWithQuery(
            <ModelConfigPanel
                model={modelOverride}
                providerDefaults={{ temperature: 0.2, top_p: 1 }}
            />,
        );
        // Model's own temperature (0.7) overrides the provider default (0.2);
        // top_p is inherited as-is.
        expect(preTexts(container)).toContain(JSON.stringify({ temperature: 0.7, top_p: 1 }, null, 2));
    });

    it("shows 'empty' for both Provider and Model blocks when both are unset", () => {
        const bareModel = { ...modelOverride, default_params: {} };
        renderWithQuery(<ModelConfigPanel model={bareModel} providerDefaults={null} />);
        // Provider + Model are both empty; Effective merges to {} too (also empty).
        expect(screen.getAllByText("empty")).toHaveLength(3);
    });

    it("falls back to {} when default_params is undefined, and omits the Provider sublabel when provider is null", () => {
        const noDefaults = {
            ...modelOverride,
            provider: null,
            default_params: undefined as unknown as Record<string, unknown>,
        };
        const { container } = renderWithQuery(<ModelConfigPanel model={noDefaults} providerDefaults={null} />);
        // Provider + Model + Effective all collapse to "empty" (default_params ?? {}).
        expect(screen.getAllByText("empty")).toHaveLength(3);
        // model.provider ?? undefined -> falsy -> no sublabel span for the
        // Provider block; only the Model block's sublabel (model.name) renders.
        const sublabels = Array.from(container.querySelectorAll(".truncate"));
        expect(sublabels).toHaveLength(1);
        expect(sublabels[0]).toHaveTextContent(noDefaults.name);
    });

    it("shows the model's provider name and model name as block sublabels", () => {
        renderWithQuery(<ModelConfigPanel model={modelOverride} providerDefaults={null} />);
        expect(screen.getByText(modelOverride.provider!)).toBeInTheDocument();
        expect(screen.getByText(modelOverride.name)).toBeInTheDocument();
    });

    it("renders 'No upstream entry available.' when meta is null", () => {
        renderWithQuery(<ModelConfigPanel model={modelOverride} providerDefaults={null} />);
        expect(screen.getByText("No upstream entry available.")).toBeInTheDocument();
    });

    it("does not render any supported_apis / rejected_fields badges when meta is null", () => {
        renderWithQuery(<ModelConfigPanel model={modelOverride} providerDefaults={null} />);
        expect(screen.queryByText(/^−/)).not.toBeInTheDocument();
        expect(screen.queryByText("chat.completions")).not.toBeInTheDocument();
    });

    it("renders a badge per supported_api and the raw JSON when meta is present", () => {
        const { container } = renderWithQuery(<ModelConfigPanel model={modelDiscovered} providerDefaults={null} />);
        expect(screen.getByText("chat.completions")).toBeInTheDocument();
        expect(screen.getByText("responses")).toBeInTheDocument();
        expect(preTexts(container)).toContain(JSON.stringify(modelDiscovered.meta!.raw, null, 2));
        expect(screen.queryByText("No upstream entry available.")).not.toBeInTheDocument();
    });

    it("renders a '−field' badge for each rejected_field, with an explanatory title", () => {
        const withRejected = {
            ...modelDiscovered,
            meta: { ...modelDiscovered.meta!, rejected_fields: ["max_tokens", "stream_options"] },
        };
        renderWithQuery(<ModelConfigPanel model={withRejected} providerDefaults={null} />);
        const badge = screen.getByText("−max_tokens");
        expect(badge).toBeInTheDocument();
        expect(badge).toHaveAttribute("title", "Adapter strips this field before sending");
        expect(screen.getByText("−stream_options")).toBeInTheDocument();
    });

    it("shows the badge row for rejected_fields alone, even with no supported_apis", () => {
        const withRejectedOnly = {
            ...modelDiscovered,
            meta: { ...modelDiscovered.meta!, supported_apis: [], rejected_fields: ["top_k"] },
        };
        renderWithQuery(<ModelConfigPanel model={withRejectedOnly} providerDefaults={null} />);
        expect(screen.getByText("−top_k")).toBeInTheDocument();
    });

    it("hides the badge row when meta exists but both supported_apis and rejected_fields are empty", () => {
        const emptyMeta = {
            ...modelDiscovered,
            meta: { ...modelDiscovered.meta!, supported_apis: [], rejected_fields: undefined },
        };
        renderWithQuery(<ModelConfigPanel model={emptyMeta} providerDefaults={null} />);
        expect(screen.queryByText(/^−/)).not.toBeInTheDocument();
        expect(screen.queryByText("chat.completions")).not.toBeInTheDocument();
        // meta.raw is still present, so the raw JSON panel renders (not the "no entry" message).
        expect(screen.queryByText("No upstream entry available.")).not.toBeInTheDocument();
    });

    it("renders 'No upstream entry available.' when meta is present but meta.raw is absent", () => {
        const noRaw = { ...modelDiscovered, meta: { ...modelDiscovered.meta!, raw: undefined } };
        renderWithQuery(<ModelConfigPanel model={noRaw} providerDefaults={null} />);
        expect(screen.getByText("No upstream entry available.")).toBeInTheDocument();
    });
});
