// Supplementary coverage for the ACTUAL admin-only gating logic behind
// "components/users/**" — the three named components there
// (users-table/user-form-dialog/user-filters) are purely presentational
// and contain no role checks themselves. The real gate ("Access Denied"
// screen + `users.useList(..., { enabled: role === "admin" })`) lives here,
// in the page that composes them.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";

import { renderWithQuery } from "./_render";
import { adminUser, normalUser } from "./_fixtures";
import { makeQuery, makeMutation } from "./_mocks";
import UsersPage from "@/app/(dashboard)/settings/users/page";
import { useAuth } from "@/context/auth-context";
import { users } from "@/lib/api/users";

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
    useSearchParams: () => new URLSearchParams(),
    usePathname: () => "/settings/users",
}));

vi.mock("@/context/auth-context", () => ({
    useAuth: vi.fn(),
}));

vi.mock("@/lib/api/users", () => ({
    users: {
        useList: vi.fn(),
        useCreate: vi.fn(),
        useUpdate: vi.fn(),
        useDelete: vi.fn(),
    },
}));

function setup() {
    vi.mocked(users.useCreate).mockReturnValue(makeMutation() as ReturnType<typeof makeMutation>);
    vi.mocked(users.useUpdate).mockReturnValue(makeMutation() as ReturnType<typeof makeMutation>);
    vi.mocked(users.useDelete).mockReturnValue(makeMutation() as ReturnType<typeof makeMutation>);
}

beforeEach(() => {
    vi.clearAllMocks();
    setup();
});

describe("UsersPage — admin-only gating", () => {
    it("shows an Access Denied screen for a non-admin user, and never calls users.useList enabled", () => {
        vi.mocked(useAuth).mockReturnValue({ user: normalUser, isLoading: false, login: vi.fn(), logout: vi.fn() });
        const listSpy = vi.mocked(users.useList).mockReturnValue(
            makeQuery({ data: { items: [], total: 0 } }) as ReturnType<typeof makeQuery>,
        );

        renderWithQuery(<UsersPage />);

        expect(screen.getByText("Access Denied")).toBeInTheDocument();
        expect(
            screen.getByText("User management is restricted to administrators only."),
        ).toBeInTheDocument();
        expect(screen.queryByPlaceholderText("Username")).not.toBeInTheDocument();
        // The list query is still invoked by the hook (rules-of-hooks require
        // an unconditional call) but must be gated off via `enabled: false`.
        expect(listSpy).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ enabled: false }));
    });

    it("shows an Access Denied screen when there is no authenticated user at all", () => {
        vi.mocked(useAuth).mockReturnValue({ user: null, isLoading: false, login: vi.fn(), logout: vi.fn() });
        vi.mocked(users.useList).mockReturnValue(
            makeQuery({ data: { items: [], total: 0 } }) as ReturnType<typeof makeQuery>,
        );

        renderWithQuery(<UsersPage />);
        expect(screen.getByText("Access Denied")).toBeInTheDocument();
    });

    it("renders the full user management UI for an admin, with the list query enabled", () => {
        vi.mocked(useAuth).mockReturnValue({ user: adminUser, isLoading: false, login: vi.fn(), logout: vi.fn() });
        const listSpy = vi.mocked(users.useList).mockReturnValue(
            makeQuery({ data: { items: [adminUser, normalUser], total: 2 } }) as ReturnType<typeof makeQuery>,
        );

        renderWithQuery(<UsersPage />);

        expect(screen.queryByText("Access Denied")).not.toBeInTheDocument();
        expect(screen.getByPlaceholderText("Username")).toBeInTheDocument();
        expect(screen.getByText("bob")).toBeInTheDocument();
        expect(listSpy).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ enabled: true }));
    });

    it("opens the create-user dialog when an admin clicks 'Add User'", async () => {
        const { default: userEvent } = await import("@testing-library/user-event");
        const user = userEvent.setup();
        vi.mocked(useAuth).mockReturnValue({ user: adminUser, isLoading: false, login: vi.fn(), logout: vi.fn() });
        vi.mocked(users.useList).mockReturnValue(
            makeQuery({ data: { items: [], total: 0 } }) as ReturnType<typeof makeQuery>,
        );

        renderWithQuery(<UsersPage />);
        await user.click(screen.getByRole("button", { name: /add user/i }));
        // The dialog title is also "Add User" — target it specifically as a
        // heading to disambiguate from the still-rendered filter-bar button.
        expect(screen.getByRole("heading", { name: "Add User" })).toBeInTheDocument();
    });
});
