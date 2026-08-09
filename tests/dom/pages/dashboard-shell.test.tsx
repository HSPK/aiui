import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Topbar and AutoHealthChecks are heavy client components (auth, prefs,
// MCP/provider polling) that belong to components/**, not app/**. Stub
// them so this file exercises only DashboardLayout's own composition.
vi.mock("@/components/Topbar", () => ({
    Topbar: () => <div data-testid="topbar">Topbar</div>,
}));
vi.mock("@/components/AutoHealthChecks", () => ({
    AutoHealthChecks: () => <div data-testid="auto-health-checks" />,
}));

import DashboardLayout from "@/app/(dashboard)/layout";
import DashboardError from "@/app/(dashboard)/error";

describe("DashboardLayout", () => {
    it("renders Topbar, children and AutoHealthChecks", () => {
        render(
            <DashboardLayout>
                <p>page content</p>
            </DashboardLayout>,
        );
        expect(screen.getByTestId("topbar")).toBeInTheDocument();
        expect(screen.getByText("page content")).toBeInTheDocument();
        expect(screen.getByTestId("auto-health-checks")).toBeInTheDocument();
    });
});

describe("DashboardError", () => {
    beforeEach(() => {
        vi.spyOn(console, "error").mockImplementation(() => {});
    });
    afterEach(() => {
        vi.mocked(console.error).mockRestore();
    });

    it("renders the error message and digest, and wires reset()", async () => {
        const user = userEvent.setup();
        const reset = vi.fn();
        const error = Object.assign(new Error("boom"), { digest: "abc123" });
        render(<DashboardError error={error} reset={reset} />);

        expect(screen.getByText("Something went wrong")).toBeInTheDocument();
        expect(screen.getByText("boom")).toBeInTheDocument();
        expect(screen.getByText(/abc123/)).toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: /try again/i }));
        expect(reset).toHaveBeenCalledTimes(1);
    });

    it("falls back to a generic message when error.message is empty, and omits the digest line", () => {
        const error = Object.assign(new Error(""), {});
        render(<DashboardError error={error} reset={vi.fn()} />);
        expect(screen.getByText("An unexpected error occurred.")).toBeInTheDocument();
        expect(screen.queryByText(/digest:/)).not.toBeInTheDocument();
    });

    it("navigates home via window.location on 'Back to dashboard'", async () => {
        const user = userEvent.setup();
        const originalLocation = window.location;
        // jsdom throws on direct href assignment navigation attempts in
        // some configs; stub location so the click handler is exercised
        // without a real navigation.
        Object.defineProperty(window, "location", {
            configurable: true,
            value: { ...originalLocation, href: "" },
        });

        render(<DashboardError error={new Error("x")} reset={vi.fn()} />);
        await user.click(screen.getByRole("button", { name: /back to dashboard/i }));
        expect(window.location.href).toBe("/");

        Object.defineProperty(window, "location", {
            configurable: true,
            value: originalLocation,
        });
    });

    it("logs the crash (with digest) to the console", () => {
        const error = Object.assign(new Error("crash"), { digest: "d1" });
        render(<DashboardError error={error} reset={vi.fn()} />);
        expect(console.error).toHaveBeenCalledWith("[loom] dashboard segment crashed:", error);
    });
});
