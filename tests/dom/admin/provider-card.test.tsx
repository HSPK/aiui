import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithQuery } from "./_render";
import {
    providerWithHealth,
    providerNoHealthUrl,
    providerAzure,
} from "./_fixtures";
import { ProviderCard } from "@/components/providers/provider-card";

describe("ProviderCard", () => {
    it("renders provider name", () => {
        renderWithQuery(<ProviderCard provider={providerWithHealth} />);
        expect(screen.getByText("OpenAI")).toBeInTheDocument();
    });

    it("renders n_models count", () => {
        renderWithQuery(<ProviderCard provider={providerWithHealth} />);
        expect(screen.getByText("12")).toBeInTheDocument();
    });

    it("renders 0 when n_models is undefined", () => {
        const p = { ...providerWithHealth, n_models: undefined as unknown as number };
        renderWithQuery(<ProviderCard provider={p} />);
        expect(screen.getByText("0")).toBeInTheDocument();
    });

    it("renders proxy/endpoint badge", () => {
        renderWithQuery(<ProviderCard provider={providerWithHealth} />);
        expect(screen.getByTitle(/Endpoint:/)).toBeInTheDocument();
        expect(screen.getByText(providerWithHealth.proxy)).toBeInTheDocument();
    });

    it("calls onClick when card is clicked", async () => {
        const onClick = vi.fn();
        renderWithQuery(<ProviderCard provider={providerWithHealth} onClick={onClick} />);
        screen.getByText("OpenAI").click();
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it("clicking document_page link does NOT bubble to card onClick", async () => {
        const onClick = vi.fn();
        renderWithQuery(<ProviderCard provider={providerWithHealth} onClick={onClick} />);
        const docLink = screen.getByTitle("Documentation");
        docLink.click();
        expect(onClick).not.toHaveBeenCalled();
    });

    it("clicking model_page link does NOT bubble to card onClick", async () => {
        const onClick = vi.fn();
        renderWithQuery(<ProviderCard provider={providerWithHealth} onClick={onClick} />);
        const modelLink = screen.getByTitle("View Models");
        modelLink.click();
        expect(onClick).not.toHaveBeenCalled();
    });

    it("renders model_page link as anchor when URL is set", () => {
        renderWithQuery(<ProviderCard provider={providerWithHealth} />);
        const link = screen.getByTitle("View Models");
        expect(link.tagName).toBe("A");
        expect(link).toHaveAttribute("href", providerWithHealth.model_page);
    });

    it("renders model_page as non-anchor (disabled icon) when URL is null", () => {
        const p = { ...providerWithHealth, model_page: "" };
        renderWithQuery(<ProviderCard provider={p} />);
        expect(screen.queryByTitle("View Models")).toBeNull();
    });

    it("renders document_page link as anchor when URL is set", () => {
        renderWithQuery(<ProviderCard provider={providerWithHealth} />);
        const link = screen.getByTitle("Documentation");
        expect(link.tagName).toBe("A");
        expect(link).toHaveAttribute("href", providerWithHealth.document_page!);
    });

    it("renders document_page as non-anchor when URL is null", () => {
        const p = { ...providerWithHealth, document_page: "" };
        renderWithQuery(<ProviderCard provider={p} />);
        expect(screen.queryByTitle("Documentation")).toBeNull();
    });

    it("shows 'Operational' pill for provider with health", () => {
        renderWithQuery(<ProviderCard provider={providerWithHealth} />);
        expect(screen.getByText("Operational")).toBeInTheDocument();
    });

    it("does NOT show health pill when health_check_url is null", () => {
        renderWithQuery(<ProviderCard provider={providerNoHealthUrl} />);
        expect(screen.queryByText("Operational")).toBeNull();
        expect(screen.queryByText("Down")).toBeNull();
        expect(screen.queryByText("Unchecked")).toBeNull();
    });

    it("shows adapter badge for non-openai adapter, stripping azure- prefix", () => {
        renderWithQuery(<ProviderCard provider={providerAzure} />);
        expect(screen.getByText("Azure OpenAI")).toBeInTheDocument();
    });

    it("does NOT show adapter badge for openai adapter", () => {
        renderWithQuery(<ProviderCard provider={providerWithHealth} />);
        // openai adapter_id should not render a badge
        // The badge renders adapter_id.replace(/^azure-/, "Azure ")
        // For "openai" adapter there's no badge per the conditional
        const badges = screen.queryAllByText("openai");
        // The badge text would be "openai" but the condition is adapter_id !== "openai"
        // so no badge should appear for exact "openai"
        expect(badges.filter(el => el.classList.contains("uppercase")).length).toBe(0);
    });

    it("clicking endpoint badge does NOT bubble to card onClick (stopPropagation)", async () => {
        const onClick = vi.fn();
        renderWithQuery(<ProviderCard provider={providerWithHealth} onClick={onClick} />);
        const badge = screen.getByTitle(/Endpoint:/);
        badge.click();
        expect(onClick).not.toHaveBeenCalled();
    });

    it("renders without document_page or model_page (both null)", () => {
        const p = { ...providerWithHealth, document_page: "", model_page: "" };
        renderWithQuery(<ProviderCard provider={p} />);
        expect(screen.queryByTitle("Documentation")).toBeNull();
        expect(screen.queryByTitle("View Models")).toBeNull();
    });

    it("renders without adapter badge when adapter_id is null", () => {
        const p = { ...providerWithHealth, adapter_id: "" };
        renderWithQuery(<ProviderCard provider={p} />);
        // No adapter badge rendered
        const badges = document.querySelectorAll(".uppercase");
        // Should not render an adapter badge
        expect(badges.length).toBeLessThan(3);
    });

    it("renders hoverActions slot and shows it alongside n_models count", () => {
        renderWithQuery(
            <ProviderCard
                provider={providerWithHealth}
                hoverActions={<button>Edit Provider</button>}
            />,
        );
        // Both elements exist in DOM simultaneously (CSS opacity-based hover)
        expect(screen.getByText("Edit Provider")).toBeInTheDocument();
        expect(screen.getByText("12")).toBeInTheDocument();
    });
});
