import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const useAuthMock = vi.fn();
vi.mock("@/context/auth-context", () => ({
    useAuth: () => useAuthMock(),
}));

import LoginPage from "@/app/(auth)/login/page";

describe("LoginPage", () => {
    beforeEach(() => {
        useAuthMock.mockReset();
    });

    it("renders the login form", () => {
        useAuthMock.mockReturnValue({ login: vi.fn(), logout: vi.fn(), user: null, isLoading: false });
        render(<LoginPage />);
        expect(screen.getByText("Login")).toBeInTheDocument();
        expect(screen.getByLabelText("Username")).toBeInTheDocument();
        expect(screen.getByLabelText("Password")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
    });

    it("submits the form mapping 'email' field -> user_name and toggles the loading spinner", async () => {
        const user = userEvent.setup();
        let resolveLogin!: () => void;
        const login = vi.fn(() => new Promise<void>((resolve) => { resolveLogin = resolve; }));
        useAuthMock.mockReturnValue({ login, logout: vi.fn(), user: null, isLoading: false });

        render(<LoginPage />);
        await user.type(screen.getByLabelText("Username"), "admin");
        await user.type(screen.getByLabelText("Password"), "secret");
        await user.click(screen.getByRole("button", { name: /sign in/i }));

        expect(login).toHaveBeenCalledWith({ user_name: "admin", user_password: "secret" });
        // isLoading flips true while the login promise is in flight — the
        // submit button becomes disabled and shows the spinner icon.
        expect(screen.getByRole("button", { name: /sign in/i })).toBeDisabled();

        resolveLogin();
        await screen.findByRole("button", { name: /sign in/i, hidden: false });
    });

    it("swallows a rejected login (error surfaced via toast in AuthProvider) and re-enables the form", async () => {
        const user = userEvent.setup();
        const login = vi.fn().mockRejectedValue(new Error("Invalid credentials"));
        useAuthMock.mockReturnValue({ login, logout: vi.fn(), user: null, isLoading: false });

        render(<LoginPage />);
        await user.type(screen.getByLabelText("Username"), "admin");
        await user.type(screen.getByLabelText("Password"), "wrong");
        await user.click(screen.getByRole("button", { name: /sign in/i }));

        expect(login).toHaveBeenCalledTimes(1);
        // finally{} always re-enables the button, even on rejection.
        expect(await screen.findByRole("button", { name: /sign in/i })).not.toBeDisabled();
    });

    it("requires both fields (native HTML validation) before submit fires", () => {
        useAuthMock.mockReturnValue({ login: vi.fn(), logout: vi.fn(), user: null, isLoading: false });
        render(<LoginPage />);
        expect(screen.getByLabelText("Username")).toBeRequired();
        expect(screen.getByLabelText("Password")).toBeRequired();
    });
});
