import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Topbar } from "@/components/Topbar";
import { useModalityStore } from "@/lib/stores/modality-store";

const mockPush = vi.fn();
const mockUsePathname = vi.fn<() => string>(() => "/");
vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: mockPush, replace: vi.fn(), refresh: vi.fn() }),
    usePathname: () => mockUsePathname(),
    useSearchParams: () => new URLSearchParams(),
}));

const mockLogout = vi.fn();
const mockUseAuth = vi.fn(() => ({
    user: { id: "1", username: "alice", role: "user" as string, created_at: "" },
    isLoading: false,
    login: vi.fn(),
    logout: mockLogout,
}));
vi.mock("@/context/auth-context", () => ({
    useAuth: () => mockUseAuth(),
}));

const mockUsePrefsGet = vi.fn(() => ({ data: undefined as { user_name?: string; user_avatar?: string } | undefined }));
vi.mock("@/lib/api/preferences", () => ({
    preferences: { useGet: () => mockUsePrefsGet() },
}));

beforeEach(() => {
    mockUsePathname.mockReturnValue("/");
    mockUseAuth.mockReturnValue({
        user: { id: "1", username: "alice", role: "user", created_at: "" },
        isLoading: false,
        login: vi.fn(),
        logout: mockLogout,
    });
    mockUsePrefsGet.mockReturnValue({ data: undefined });
    // Reset the real (persisted) modality store between tests so
    // `lastPath` / `chatHistoryOpen` from one test don't leak to the next.
    useModalityStore.setState({ lastPath: null, chatHistoryOpen: false, modalityPaths: {} });
    window.localStorage.clear();
});

describe("Topbar — desktop nav", () => {
    it("renders the primary nav links", () => {
        render(<Topbar />);
        expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("href", "/");
        expect(screen.getByRole("link", { name: "Logs" })).toHaveAttribute("href", "/logs");
        expect(screen.getByRole("link", { name: "Providers" })).toHaveAttribute("href", "/providers");
        expect(screen.getByRole("link", { name: "MCP" })).toHaveAttribute("href", "/mcp");
    });

    it("highlights the active nav item for the current pathname", () => {
        mockUsePathname.mockReturnValue("/logs");
        render(<Topbar />);
        expect(screen.getByRole("link", { name: "Logs" })).toHaveClass("bg-muted");
        expect(screen.getByRole("link", { name: "Dashboard" })).not.toHaveClass("bg-muted");
    });

    it("treats a nested path as active for its parent nav item", () => {
        mockUsePathname.mockReturnValue("/providers/openai");
        render(<Topbar />);
        expect(screen.getByRole("link", { name: "Providers" })).toHaveClass("bg-muted");
    });

    it("only matches Dashboard exactly at '/', not for every other route", () => {
        mockUsePathname.mockReturnValue("/logs");
        render(<Topbar />);
        expect(screen.getByRole("link", { name: "Dashboard" })).not.toHaveClass("bg-muted");
    });

    it("renders a 'Playground' link (resumes last modality) outside /playground routes", () => {
        mockUsePathname.mockReturnValue("/");
        render(<Topbar />);
        const link = screen.getByRole("link", { name: "Playground" });
        expect(link).toHaveAttribute("href", "/playground/chat");
    });

    it("resumes the last-visited modality path when set in the store", () => {
        useModalityStore.setState({ lastPath: "/playground/embedding" });
        mockUsePathname.mockReturnValue("/");
        render(<Topbar />);
        expect(screen.getByRole("link", { name: "Playground" })).toHaveAttribute(
            "href",
            "/playground/embedding",
        );
    });

    it("renders the plain Playground link (not the strip) while exactly on /playground", () => {
        mockUsePathname.mockReturnValue("/playground");
        render(<Topbar />);
        expect(screen.getByRole("link", { name: "Playground" })).toBeInTheDocument();
        expect(screen.queryByLabelText("Playground modalities")).not.toBeInTheDocument();
    });

    it("swaps in the inline modality strip once inside a /playground sub-route", () => {
        mockUsePathname.mockReturnValue("/playground/chat");
        render(<Topbar />);
        // Topbar.tsx's own branch (PlaygroundSlot) is what's under test here;
        // the strip's internal tab behaviour is out of this assignment's scope.
        expect(screen.getByLabelText("Playground modalities")).toBeInTheDocument();
    });
});

describe("Topbar — mobile title", () => {
    it.each([
        ["/", "Dashboard"],
        ["/logs", "Logs"],
        ["/providers", "Providers"],
        ["/mcp", "MCP"],
        ["/settings", "Settings"],
        ["/models", "Models"],
    ])("shows '%s' -> '%s'", (path, expected) => {
        mockUsePathname.mockReturnValue(path);
        render(<Topbar />);
        // MobileTitle text is duplicated visually across breakpoints via
        // Tailwind's `md:hidden`; just assert it's present somewhere.
        expect(screen.getAllByText(expected).length).toBeGreaterThan(0);
    });

    it("shows the matched modality's title while inside /playground", () => {
        mockUsePathname.mockReturnValue("/playground/embedding");
        render(<Topbar />);
        expect(screen.getAllByText("Embeddings").length).toBeGreaterThan(0);
    });

    it("falls back to the plain 'Playground' title at the bare /playground root (no modality match)", () => {
        mockUsePathname.mockReturnValue("/playground");
        render(<Topbar />);
        expect(screen.getAllByText("Playground").length).toBeGreaterThan(0);
    });
});

describe("Topbar — mobile chat-history trigger", () => {
    it("is hidden outside /playground/chat", () => {
        mockUsePathname.mockReturnValue("/");
        render(<Topbar />);
        expect(screen.queryByRole("button", { name: "Open conversations" })).not.toBeInTheDocument();
    });

    it("appears on /playground/chat and opens chatHistoryOpen on click", async () => {
        const user = userEvent.setup();
        mockUsePathname.mockReturnValue("/playground/chat");
        render(<Topbar />);
        const trigger = screen.getByRole("button", { name: "Open conversations" });
        await user.click(trigger);
        expect(useModalityStore.getState().chatHistoryOpen).toBe(true);
    });
});

describe("Topbar — mobile nav sheet", () => {
    it("opens the mobile sheet and lists Dashboard, Playground, modalities, and trailing nav", async () => {
        const user = userEvent.setup();
        mockUsePathname.mockReturnValue("/");
        render(<Topbar />);

        await user.click(screen.getByRole("button", { name: "Open menu" }));

        const dialog = await screen.findByRole("dialog");
        const scoped = within(dialog);
        expect(scoped.getByRole("link", { name: /Dashboard/ })).toBeInTheDocument();
        expect(scoped.getByRole("link", { name: /Playground/ })).toBeInTheDocument();
        // Non-disabled modalities are listed (e.g. Chat); the disabled
        // "Rerank" entry is filtered out.
        expect(scoped.getByRole("link", { name: /Chat/ })).toBeInTheDocument();
        expect(scoped.queryByRole("link", { name: /Rerank/ })).not.toBeInTheDocument();
        expect(scoped.getByRole("link", { name: /Logs/ })).toBeInTheDocument();
        expect(scoped.getByRole("link", { name: /Providers/ })).toBeInTheDocument();
        expect(scoped.getByRole("link", { name: /MCP/ })).toBeInTheDocument();
    });

    it("closes the sheet automatically when the pathname changes", async () => {
        const user = userEvent.setup();
        mockUsePathname.mockReturnValue("/");
        const { rerender } = render(<Topbar />);
        await user.click(screen.getByRole("button", { name: "Open menu" }));
        expect(await screen.findByRole("dialog")).toBeInTheDocument();

        mockUsePathname.mockReturnValue("/logs");
        rerender(<Topbar />);
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
});

describe("Topbar — user menu", () => {
    it("shows the default display name/avatar when preferences haven't loaded", () => {
        mockUsePrefsGet.mockReturnValue({ data: undefined });
        render(<Topbar />);
        expect(screen.getByRole("button", { name: /User/ })).toBeInTheDocument();
    });

    it("shows the user's configured display name and avatar", () => {
        mockUsePrefsGet.mockReturnValue({ data: { user_name: "Alice", user_avatar: "🚀" } });
        render(<Topbar />);
        expect(screen.getByRole("button", { name: /Alice/ })).toBeInTheDocument();
    });

    it("falls back to the default 👤 avatar when user_avatar is an empty string", () => {
        mockUsePrefsGet.mockReturnValue({ data: { user_name: "Alice", user_avatar: "" } });
        render(<Topbar />);
        expect(screen.getByRole("button", { name: /👤/ })).toBeInTheDocument();
    });

    it("does not show an Admin badge for a regular user, and hides the Users item", async () => {
        const user = userEvent.setup();
        mockUseAuth.mockReturnValue({
            user: { id: "1", username: "alice", role: "user", created_at: "" },
            isLoading: false,
            login: vi.fn(),
            logout: mockLogout,
        });
        render(<Topbar />);
        await user.click(screen.getByRole("button", { name: /User/ }));
        expect(screen.queryByText("Admin")).not.toBeInTheDocument();
        expect(screen.queryByRole("menuitem", { name: /Users/ })).not.toBeInTheDocument();
        expect(screen.getByRole("menuitem", { name: /Settings/ })).toBeInTheDocument();
        expect(screen.getByRole("menuitem", { name: /API Keys/ })).toBeInTheDocument();
    });

    it("shows an Admin badge and the Users item for an admin", async () => {
        const user = userEvent.setup();
        mockUseAuth.mockReturnValue({
            user: { id: "1", username: "admin", role: "admin", created_at: "" },
            isLoading: false,
            login: vi.fn(),
            logout: mockLogout,
        });
        render(<Topbar />);
        await user.click(screen.getByRole("button", { name: /User/ }));
        expect(screen.getByText("Admin")).toBeInTheDocument();
        expect(screen.getByRole("menuitem", { name: /Users/ })).toBeInTheDocument();
    });

    it("navigates via router.push when a menu item is clicked", async () => {
        const user = userEvent.setup();
        render(<Topbar />);
        await user.click(screen.getByRole("button", { name: /User/ }));
        await user.click(screen.getByRole("menuitem", { name: /API Keys/ }));
        expect(mockPush).toHaveBeenCalledWith("/settings/api-keys");
    });

    it("calls logout() when Logout is clicked", async () => {
        const user = userEvent.setup();
        render(<Topbar />);
        await user.click(screen.getByRole("button", { name: /User/ }));
        await user.click(screen.getByRole("menuitem", { name: /Logout/ }));
        expect(mockLogout).toHaveBeenCalledTimes(1);
    });
});
