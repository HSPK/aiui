import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { ProviderIcon } from "@/components/ProviderIcon";

// `<img alt="">` is intentionally decorative, so it's excluded from the
// accessibility tree's "img" role (empty alt => role="presentation").
// Query it directly off the container instead of screen.getByRole.
function getImg(container: HTMLElement): HTMLImageElement | null {
    return container.querySelector("img");
}

describe("ProviderIcon", () => {
    it("renders the mapped logo for a known provider", () => {
        const { container } = render(<ProviderIcon providerName="openai" />);
        expect(getImg(container)).toHaveAttribute("src", "/providers/openai.svg");
    });

    it("normalizes case (OpenAI -> openai)", () => {
        const { container } = render(<ProviderIcon providerName="OpenAI" />);
        expect(getImg(container)).toHaveAttribute("src", "/providers/openai.svg");
    });

    it("strips non-alphanumeric characters before lookup (Open-AI -> openai)", () => {
        const { container } = render(<ProviderIcon providerName="Open-AI" />);
        expect(getImg(container)).toHaveAttribute("src", "/providers/openai.svg");
    });

    it("maps 'anthropic' to the same logo as 'claude'", () => {
        const { container } = render(<ProviderIcon providerName="anthropic" />);
        expect(getImg(container)).toHaveAttribute("src", "/providers/claude.svg");
    });

    it("maps 'google' to the same logo as 'gemini'", () => {
        const { container } = render(<ProviderIcon providerName="google" />);
        expect(getImg(container)).toHaveAttribute("src", "/providers/gemini.svg");
    });

    it("maps 'alibabacloud' to the same logo as 'aliyun'", () => {
        const { container } = render(<ProviderIcon providerName="alibabacloud" />);
        expect(getImg(container)).toHaveAttribute("src", "/providers/alibabacloud.png");
    });

    it("keeps 'vertex' and 'vertexai' as distinct logos", () => {
        const { container, rerender } = render(<ProviderIcon providerName="vertex" />);
        expect(getImg(container)).toHaveAttribute("src", "/providers/vertex.svg");
        rerender(<ProviderIcon providerName="vertexai" />);
        expect(getImg(container)).toHaveAttribute("src", "/providers/vertexai.svg");
    });

    it("applies dark:invert only for providers in the dark-invert set", () => {
        const { container } = render(<ProviderIcon providerName="openai" />);
        expect(getImg(container)).toHaveClass("dark:invert");
    });

    it("does not apply dark:invert for providers outside the dark-invert set", () => {
        const { container } = render(<ProviderIcon providerName="claude" />);
        expect(getImg(container)).not.toHaveClass("dark:invert");
    });

    it("uses 24x24 dimensions by default", () => {
        const { container } = render(<ProviderIcon providerName="openai" />);
        const img = getImg(container);
        expect(img).toHaveAttribute("width", "24");
        expect(img).toHaveAttribute("height", "24");
    });

    it("honors custom width/height", () => {
        const { container } = render(<ProviderIcon providerName="openai" width={40} height={40} />);
        const img = getImg(container);
        expect(img).toHaveAttribute("width", "40");
        expect(img).toHaveAttribute("height", "40");
    });

    it("merges a custom className onto the <img>", () => {
        const { container } = render(<ProviderIcon providerName="openai" className="ring-2" />);
        expect(getImg(container)).toHaveClass("ring-2", "object-contain", "shrink-0");
    });

    it("falls back to initials for an unmapped provider name", () => {
        const { container } = render(<ProviderIcon providerName="zz-unknown" />);
        expect(getImg(container)).not.toBeInTheDocument();
        expect(screen.getByText("ZZ")).toBeInTheDocument();
    });

    it("falls back to initials from the RAW (non-normalized) name, not the stripped one", () => {
        // substring(0,2) is taken from the original providerName, so a
        // leading punctuation character IS included in the fallback text
        // even though it's stripped from the lookup key.
        render(<ProviderIcon providerName="123unknown" />);
        expect(screen.getByText("12")).toBeInTheDocument();
    });

    it("renders an empty fallback (no crash) for an empty provider name", () => {
        const { container } = render(<ProviderIcon providerName="" />);
        expect(getImg(container)).not.toBeInTheDocument();
        const span = container.querySelector("span");
        expect(span).toBeInTheDocument();
        expect(span).toHaveTextContent("");
    });

    it("swaps to the initials fallback when the mapped logo <img> fails to load", () => {
        const { container } = render(<ProviderIcon providerName="openai" />);
        const img = getImg(container);
        expect(img).not.toBeNull();
        fireEvent.error(img!);
        expect(getImg(container)).not.toBeInTheDocument();
        expect(screen.getByText("OP")).toBeInTheDocument();
    });

    it("applies a custom className to the fallback span too", () => {
        render(<ProviderIcon providerName="unknown-vendor" className="ring-2" />);
        expect(screen.getByText("UN")).toHaveClass("ring-2");
    });
});
