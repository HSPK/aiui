import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useQueryClient } from "@tanstack/react-query";
import { QueryClient } from "@tanstack/react-query";
import * as React from "react";

import { AppProviders } from "@/components/AppProviders";
import { useAuth } from "@/context/auth-context";

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
    useSearchParams: () => new URLSearchParams(),
    usePathname: () => "/login",
}));

vi.mock("@/lib/api/auth", () => ({
    auth: {
        me: vi.fn().mockResolvedValue(null),
        login: vi.fn(),
        logout: vi.fn(),
        changeOwnPassword: vi.fn(),
    },
}));

vi.mock("@/lib/api/preferences", () => ({
    preferences: { useGet: () => ({ data: undefined }) },
}));

function QueryClientProbe() {
    const qc = useQueryClient();
    return <span data-testid="qc-probe">{qc instanceof QueryClient ? "has-client" : "no-client"}</span>;
}

function AuthProbe() {
    // Throws if rendered outside AuthProvider — proves AppProviders wires it up.
    const { isLoading } = useAuth();
    return <span data-testid="auth-probe">{isLoading ? "loading" : "ready"}</span>;
}

describe("AppProviders", () => {
    it("renders its children", () => {
        render(
            <AppProviders>
                <div data-testid="child">Hello</div>
            </AppProviders>,
        );
        expect(screen.getByTestId("child")).toHaveTextContent("Hello");
    });

    it("provides a working QueryClient to descendants", () => {
        render(
            <AppProviders>
                <QueryClientProbe />
            </AppProviders>,
        );
        expect(screen.getByTestId("qc-probe")).toHaveTextContent("has-client");
    });

    it("wraps children in AuthProvider (useAuth resolves without throwing)", () => {
        render(
            <AppProviders>
                <AuthProbe />
            </AppProviders>,
        );
        expect(screen.getByTestId("auth-probe")).toBeInTheDocument();
    });

    it("mounts the sonner Toaster", () => {
        render(
            <AppProviders>
                <div>content</div>
            </AppProviders>,
        );
        // Sonner only stamps `data-sonner-toaster` on the per-position <ol>
        // once a toast actually exists; with none queued, only the always-
        // present live-region <section aria-label="Notifications ..."> is
        // in the DOM, so assert on that instead.
        expect(document.querySelector('section[aria-label^="Notifications"]')).toBeInTheDocument();
    });
});
