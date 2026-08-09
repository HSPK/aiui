import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithQuery } from "./_render";
import {
    providerWithHealth,
    providerDown,
    providerUnchecked,
    providerNoHealthUrl,
} from "./_fixtures";
import { ProviderHealthPill } from "@/components/providers/provider-health-pill";

describe("ProviderHealthPill", () => {
    it("renders NOTHING when health_check_url is null (regression guard)", () => {
        // providerNoHealthUrl has stale last_health_status:"ok" but no URL
        const { container } = renderWithQuery(
            <ProviderHealthPill provider={providerNoHealthUrl} />,
        );
        expect(container).toBeEmptyDOMElement();
    });

    it("shows 'Operational' for ok status", () => {
        renderWithQuery(<ProviderHealthPill provider={providerWithHealth} />);
        expect(screen.getByText("Operational")).toBeInTheDocument();
    });

    it("shows 'Down' for down status", () => {
        renderWithQuery(<ProviderHealthPill provider={providerDown} />);
        expect(screen.getByText("Down")).toBeInTheDocument();
    });

    it("shows 'Unchecked' for null status with URL set", () => {
        renderWithQuery(<ProviderHealthPill provider={providerUnchecked} />);
        expect(screen.getByText("Unchecked")).toBeInTheDocument();
    });

    it("renders in sm size without crashing and shows label", () => {
        renderWithQuery(<ProviderHealthPill provider={providerWithHealth} size="sm" />);
        expect(screen.getByText("Operational")).toBeInTheDocument();
    });

    it("renders in md size without crashing and shows label", () => {
        renderWithQuery(<ProviderHealthPill provider={providerWithHealth} size="md" />);
        expect(screen.getByText("Operational")).toBeInTheDocument();
    });

    it("sm and md render different sized dots (class difference)", () => {
        const { container: smContainer } = renderWithQuery(
            <ProviderHealthPill provider={providerWithHealth} size="sm" />,
        );
        const { container: mdContainer } = renderWithQuery(
            <ProviderHealthPill provider={providerWithHealth} size="md" />,
        );
        // sm uses h-1 w-1, md uses h-1.5 w-1.5
        const smDot = smContainer.querySelector(".h-1.w-1");
        const mdDot = mdContainer.querySelector(".h-1\\.5.w-1\\.5");
        expect(smDot).toBeTruthy();
        expect(mdDot).toBeTruthy();
    });

    it("tooltip for ok status shows 'Last checked:' after hover", async () => {
        const user = userEvent.setup();
        renderWithQuery(<ProviderHealthPill provider={providerWithHealth} />);
        const trigger = screen.getByText("Operational");
        await user.hover(trigger);
        const tooltip = await screen.findByRole("tooltip");
        expect(tooltip.textContent).toMatch(/Last checked:/);
    });

    it("tooltip for down status shows error message and last checked", async () => {
        const user = userEvent.setup();
        renderWithQuery(<ProviderHealthPill provider={providerDown} />);
        const trigger = screen.getByText("Down");
        await user.hover(trigger);
        const tooltip = await screen.findByRole("tooltip");
        expect(tooltip.textContent).toContain("timeout after 5000ms");
        expect(tooltip.textContent).toMatch(/Last checked:/);
    });

    it("ok status with NO last_health_checked_at renders pill without tooltip wrapper", () => {
        // When status="ok" but no when → tooltipFor returns null → renders `inner` directly
        const p = { ...providerWithHealth, last_health_checked_at: null };
        renderWithQuery(<ProviderHealthPill provider={p} />);
        expect(screen.getByText("Operational")).toBeInTheDocument();
        // No TooltipProvider in the DOM (renders inner directly)
        expect(document.querySelector("[role='tooltip']")).toBeNull();
    });
});
