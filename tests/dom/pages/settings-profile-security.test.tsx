import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ProfileSection } from "@/app/(dashboard)/settings/_sections/profile";
import { SecuritySection } from "@/app/(dashboard)/settings/_sections/security";
import { defaultUserPreferences, type UserPreferencesDTO } from "@/lib/schemas/preferences";
import { mutationResult, queryResult, renderWithClient } from "./_helpers";

const useGetMock = vi.fn();
const useUpdateMock = vi.fn();
vi.mock("@/lib/api/preferences", () => ({
    preferences: {
        useGet: (...a: unknown[]) => useGetMock(...a),
        useUpdate: (...a: unknown[]) => useUpdateMock(...a),
    },
}));

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastError(...a), success: (...a: unknown[]) => toastSuccess(...a) } }));

const changeOwnPasswordMock = vi.fn();
const logoutMock = vi.fn();
vi.mock("@/lib/api/auth", () => ({
    auth: {
        changeOwnPassword: (...a: unknown[]) => changeOwnPasswordMock(...a),
        logout: (...a: unknown[]) => logoutMock(...a),
    },
}));

describe("ProfileSection", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useGetMock.mockReturnValue(queryResult<UserPreferencesDTO>({ data: { ...defaultUserPreferences, user_name: "Alice" } }));
        useUpdateMock.mockReturnValue(mutationResult({}));
    });

    it("renders the current name and avatar", () => {
        renderWithClient(<ProfileSection />);
        expect(screen.getByDisplayValue("Alice")).toBeInTheDocument();
        expect(screen.getByText(defaultUserPreferences.user_avatar)).toBeInTheDocument();
    });

    it("falls back to defaults while preferences are still loading", () => {
        useGetMock.mockReturnValue(queryResult<UserPreferencesDTO>({ data: undefined }));
        renderWithClient(<ProfileSection />);
        expect(screen.getByPlaceholderText("Your name")).toHaveValue("");
    });

    it("commits a changed name on blur", async () => {
        const user = userEvent.setup();
        const mutate = vi.fn();
        useUpdateMock.mockReturnValue(mutationResult({ mutate }));
        renderWithClient(<ProfileSection />);

        const input = screen.getByDisplayValue("Alice");
        await user.clear(input);
        await user.type(input, "Bob");
        await user.tab();
        expect(mutate).toHaveBeenCalledWith({ user_name: "Bob" }, expect.anything());
    });

    it("does not commit when blurring with an unchanged or blank name", async () => {
        const user = userEvent.setup();
        const mutate = vi.fn();
        useUpdateMock.mockReturnValue(mutationResult({ mutate }));
        renderWithClient(<ProfileSection />);

        const input = screen.getByDisplayValue("Alice");
        await user.click(input);
        await user.tab();
        expect(mutate).not.toHaveBeenCalled();

        await user.clear(input);
        await user.tab();
        expect(mutate).not.toHaveBeenCalled();
        expect(input).toHaveValue("Alice");
    });

    it("reverts the name input and toasts on a failed commit", async () => {
        const user = userEvent.setup();
        const mutate = vi.fn((_vars, opts?: { onError?: (e: Error) => void }) => opts?.onError?.(new Error("nope")));
        useUpdateMock.mockReturnValue(mutationResult({ mutate }));
        renderWithClient(<ProfileSection />);

        const input = screen.getByDisplayValue("Alice");
        await user.clear(input);
        await user.type(input, "Charlie");
        await user.tab();
        expect(toastError).toHaveBeenCalledWith("nope");
        expect(input).toHaveValue("Alice");
    });

    it("picks an avatar", async () => {
        const user = userEvent.setup();
        const mutate = vi.fn();
        useUpdateMock.mockReturnValue(mutationResult({ mutate }));
        renderWithClient(<ProfileSection />);

        await user.click(screen.getByText("🤖"));
        expect(mutate).toHaveBeenCalledWith({ user_avatar: "🤖" }, expect.anything());
    });

    it("toasts a generic error message when avatar save fails without a message", async () => {
        const user = userEvent.setup();
        const mutate = vi.fn((_vars, opts?: { onError?: (e: Error) => void }) => opts?.onError?.(new Error("")));
        useUpdateMock.mockReturnValue(mutationResult({ mutate }));
        renderWithClient(<ProfileSection />);

        await user.click(screen.getByText("🦊"));
        expect(toastError).toHaveBeenCalledWith("Failed to save");
    });

    it("falls back to a generic message when the name commit fails with no error message", async () => {
        const user = userEvent.setup();
        const mutate = vi.fn((_vars, opts?: { onError?: (e: Error) => void }) => opts?.onError?.(new Error("")));
        useUpdateMock.mockReturnValue(mutationResult({ mutate }));
        renderWithClient(<ProfileSection />);

        const input = screen.getByDisplayValue("Alice");
        await user.clear(input);
        await user.type(input, "Charlie");
        await user.tab();
        expect(toastError).toHaveBeenCalledWith("Failed to save");
        expect(input).toHaveValue("Alice");
    });

    it("commits the name via Enter", async () => {
        const user = userEvent.setup();
        const mutate = vi.fn();
        useUpdateMock.mockReturnValue(mutationResult({ mutate }));
        renderWithClient(<ProfileSection />);

        const input = screen.getByDisplayValue("Alice");
        await user.clear(input);
        await user.type(input, "Dave{Enter}");
        expect(mutate).toHaveBeenCalledWith({ user_name: "Dave" }, expect.anything());
    });
});

describe("SecuritySection", () => {
    let originalLocation: Location;

    beforeEach(() => {
        vi.clearAllMocks();
        originalLocation = window.location;
        // Stub location so the redirect-on-success branch is exercised
        // without a real (jsdom-unsupported) navigation.
        Object.defineProperty(window, "location", {
            configurable: true,
            value: { ...originalLocation, href: "" },
        });
    });

    afterEach(() => {
        Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
    });

    it("disables the submit button until all three fields are filled", async () => {
        const user = userEvent.setup();
        renderWithClient(<SecuritySection />);
        const button = screen.getByRole("button", { name: "Update password" });
        expect(button).toBeDisabled();

        await user.type(screen.getAllByDisplayValue("")[0], "old-pass");
        expect(button).toBeDisabled();
    });

    it("rejects mismatched new/confirm passwords without calling the API", async () => {
        const user = userEvent.setup();
        renderWithClient(<SecuritySection />);
        const [current, next, confirm] = screen.getAllByDisplayValue("") as HTMLInputElement[];
        await user.type(current, "old-pass");
        await user.type(next, "newpass1");
        await user.type(confirm, "newpass2");
        await user.click(screen.getByRole("button", { name: "Update password" }));

        expect(toastError).toHaveBeenCalledWith("New passwords do not match");
        expect(changeOwnPasswordMock).not.toHaveBeenCalled();
    });

    it("rejects a too-short new password", async () => {
        const user = userEvent.setup();
        renderWithClient(<SecuritySection />);
        const [current, next, confirm] = screen.getAllByDisplayValue("") as HTMLInputElement[];
        await user.type(current, "old-pass");
        await user.type(next, "abc");
        await user.type(confirm, "abc");
        await user.click(screen.getByRole("button", { name: "Update password" }));

        expect(toastError).toHaveBeenCalledWith("Password must be at least 4 characters");
        expect(changeOwnPasswordMock).not.toHaveBeenCalled();
    });

    it("changes the password, logs out, and redirects to /login on success", async () => {
        const user = userEvent.setup();
        changeOwnPasswordMock.mockResolvedValue({ ok: true });
        logoutMock.mockResolvedValue(null);
        renderWithClient(<SecuritySection />);
        const [current, next, confirm] = screen.getAllByDisplayValue("") as HTMLInputElement[];
        await user.type(current, "old-pass");
        await user.type(next, "newpass1");
        await user.type(confirm, "newpass1");
        await user.click(screen.getByRole("button", { name: "Update password" }));

        expect(changeOwnPasswordMock).toHaveBeenCalledWith({ current_password: "old-pass", new_password: "newpass1" });
        await vi.waitFor(() => expect(logoutMock).toHaveBeenCalled());
        await vi.waitFor(() => expect(window.location.href).toBe("/login"));
        expect(toastSuccess).toHaveBeenCalledWith("Password updated — please log in again");
    });

    it("still redirects even when the logout call itself fails (sessions already revoked)", async () => {
        const user = userEvent.setup();
        changeOwnPasswordMock.mockResolvedValue({ ok: true });
        logoutMock.mockRejectedValue(new Error("already revoked"));
        renderWithClient(<SecuritySection />);
        const [current, next, confirm] = screen.getAllByDisplayValue("") as HTMLInputElement[];
        await user.type(current, "old-pass");
        await user.type(next, "newpass1");
        await user.type(confirm, "newpass1");
        await user.click(screen.getByRole("button", { name: "Update password" }));

        await vi.waitFor(() => expect(window.location.href).toBe("/login"));
    });

    it("shows an error toast when the password change API call fails", async () => {
        const user = userEvent.setup();
        changeOwnPasswordMock.mockRejectedValue(new Error("server exploded"));
        renderWithClient(<SecuritySection />);
        const [current, next, confirm] = screen.getAllByDisplayValue("") as HTMLInputElement[];
        await user.type(current, "old-pass");
        await user.type(next, "newpass1");
        await user.type(confirm, "newpass1");
        await user.click(screen.getByRole("button", { name: "Update password" }));

        await vi.waitFor(() => expect(toastError).toHaveBeenCalledWith("server exploded"));
        expect(window.location.href).toBe("");
    });

    it("falls back to a generic message when the password change error has no message", async () => {
        const user = userEvent.setup();
        changeOwnPasswordMock.mockRejectedValue(new Error(""));
        renderWithClient(<SecuritySection />);
        const [current, next, confirm] = screen.getAllByDisplayValue("") as HTMLInputElement[];
        await user.type(current, "old-pass");
        await user.type(next, "newpass1");
        await user.type(confirm, "newpass1");
        await user.click(screen.getByRole("button", { name: "Update password" }));

        await vi.waitFor(() => expect(toastError).toHaveBeenCalledWith("Failed to update password"));
    });
});
