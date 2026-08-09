import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

// next/font/google requires the Next.js SWC build pipeline to resolve
// real font files; under vitest it's just a plain package import, so
// stub the loader functions with the shape RootLayout consumes
// (`.variable`).
vi.mock("next/font/google", () => ({
    Geist: () => ({ variable: "--font-geist-sans" }),
    Geist_Mono: () => ({ variable: "--font-geist-mono" }),
}));

// AppProviders composes AuthProvider (real network via /users/me),
// next-themes, TanStack Query and Sonner — all out of scope for a
// root-layout smoke test. Stub it so RootLayout's own composition
// (html/head/body structure + children passthrough) is what's exercised.
vi.mock("@/components/AppProviders", () => ({
    AppProviders: ({ children }: { children: React.ReactNode }) => (
        <div data-testid="app-providers">{children}</div>
    ),
}));

import RootLayout, { metadata } from "@/app/layout";
import NotFound from "@/app/not-found";

describe("RootLayout", () => {
    it("renders html/body structure and passes children through AppProviders", () => {
        const { getByTestId, getByText } = render(
            <RootLayout>
                <p>child content</p>
            </RootLayout>,
        );
        expect(getByTestId("app-providers")).toBeInTheDocument();
        expect(getByText("child content")).toBeInTheDocument();
        // React 19 hoists <head>-only elements (style/script/meta) to the
        // real document head rather than the render container, even when
        // <html>/<head>/<body> aren't the literal document root.
        expect(document.head.querySelector("#loom-theme-tokens")).toBeTruthy();
    });

    it("exports metadata with a title template", () => {
        expect(metadata.title).toEqual({ default: "Loom", template: "%s · Loom" });
        expect(metadata.description).toMatch(/self-hosted/i);
    });
});

describe("NotFound (app/not-found.tsx)", () => {
    it("renders the 404 message and a link back to the dashboard", () => {
        const { getByText, getByRole } = render(<NotFound />);
        expect(getByText("404")).toBeInTheDocument();
        expect(getByText("Page not found")).toBeInTheDocument();
        const link = getByRole("link", { name: /back to dashboard/i });
        expect(link).toHaveAttribute("href", "/");
    });
});
