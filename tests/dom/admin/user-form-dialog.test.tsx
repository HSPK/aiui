import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithQuery } from "./_render";
import { adminUser } from "./_fixtures";
import { makeMutation } from "./_mocks";
import { UserFormDialog } from "@/components/users/user-form-dialog";
import { users } from "@/lib/api/users";

vi.mock("@/lib/api/users", () => ({
    users: {
        useCreate: vi.fn(),
        useUpdate: vi.fn(),
    },
}));

vi.mock("sonner", () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { toast } from "sonner";

function setup() {
    const createMut = makeMutation();
    const updateMut = makeMutation();
    vi.mocked(users.useCreate).mockReturnValue(createMut as ReturnType<typeof makeMutation>);
    vi.mocked(users.useUpdate).mockReturnValue(updateMut as ReturnType<typeof makeMutation>);
    return { createMut, updateMut };
}

beforeEach(() => {
    vi.clearAllMocks();
    setup();
});

describe("UserFormDialog — create mode", () => {
    it("shows the 'Add User' title", () => {
        renderWithQuery(<UserFormDialog open mode="create" onOpenChange={vi.fn()} />);
        expect(screen.getByText("Add User")).toBeInTheDocument();
    });

    it("starts with blank username/password and role=user", () => {
        renderWithQuery(<UserFormDialog open mode="create" onOpenChange={vi.fn()} />);
        expect(screen.getByLabelText("Username")).toHaveValue("");
        expect(screen.getByLabelText("Password")).toHaveValue("");
        expect(screen.getByText("User", { selector: "span" })).toBeInTheDocument();
    });

    it("username input is enabled (not disabled) in create mode", () => {
        renderWithQuery(<UserFormDialog open mode="create" onOpenChange={vi.fn()} />);
        expect(screen.getByLabelText("Username")).not.toBeDisabled();
    });

    it("shows a validation error and does not call the mutation when username is blank", async () => {
        const user = userEvent.setup();
        const { createMut } = setup();
        renderWithQuery(<UserFormDialog open mode="create" onOpenChange={vi.fn()} />);
        await user.type(screen.getByLabelText("Password"), "secret1");
        await user.click(screen.getByRole("button", { name: "Create" }));
        expect(toast.error).toHaveBeenCalledWith("Please enter a username");
        expect(createMut.mutate).not.toHaveBeenCalled();
    });

    it("shows a validation error and does not call the mutation when password is blank", async () => {
        const user = userEvent.setup();
        const { createMut } = setup();
        renderWithQuery(<UserFormDialog open mode="create" onOpenChange={vi.fn()} />);
        await user.type(screen.getByLabelText("Username"), "newguy");
        await user.click(screen.getByRole("button", { name: "Create" }));
        expect(toast.error).toHaveBeenCalledWith("Please enter a password");
        expect(createMut.mutate).not.toHaveBeenCalled();
    });

    it("submits trimmed username, password, and default role=user to createMutation", async () => {
        const user = userEvent.setup();
        const { createMut } = setup();
        renderWithQuery(<UserFormDialog open mode="create" onOpenChange={vi.fn()} />);
        await user.type(screen.getByLabelText("Username"), "  newguy  ");
        await user.type(screen.getByLabelText("Password"), "secret1");
        await user.click(screen.getByRole("button", { name: "Create" }));
        expect(createMut.mutate).toHaveBeenCalledWith({ username: "newguy", password: "secret1", role: "user" });
    });

    it("submits role=admin when the admin option is picked from the Select", async () => {
        const user = userEvent.setup();
        const { createMut } = setup();
        renderWithQuery(<UserFormDialog open mode="create" onOpenChange={vi.fn()} />);
        await user.type(screen.getByLabelText("Username"), "newadmin");
        await user.type(screen.getByLabelText("Password"), "secret1");
        await user.click(screen.getByRole("combobox"));
        await user.click(await screen.findByRole("option", { name: /Admin/i }));
        await user.click(screen.getByRole("button", { name: "Create" }));
        expect(createMut.mutate).toHaveBeenCalledWith({ username: "newadmin", password: "secret1", role: "admin" });
    });

    it("toggles the password visibility eye icon button", async () => {
        const user = userEvent.setup();
        renderWithQuery(<UserFormDialog open mode="create" onOpenChange={vi.fn()} />);
        const pwInput = screen.getByLabelText("Password");
        expect(pwInput).toHaveAttribute("type", "password");
        // The eye toggle is the only other button besides Cancel/Create in the password row.
        const toggle = pwInput.parentElement!.querySelector("button")!;
        await user.click(toggle);
        expect(pwInput).toHaveAttribute("type", "text");
        await user.click(toggle);
        expect(pwInput).toHaveAttribute("type", "password");
    });

    it("calls onOpenChange(false) when Cancel is clicked", async () => {
        const user = userEvent.setup();
        const onOpenChange = vi.fn();
        renderWithQuery(<UserFormDialog open mode="create" onOpenChange={onOpenChange} />);
        await user.click(screen.getByRole("button", { name: "Cancel" }));
        expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it("toasts success and closes the dialog when create succeeds", () => {
        const onOpenChange = vi.fn();
        setup();
        vi.mocked(users.useCreate).mockImplementation((opts) => {
            opts?.onSuccess?.(adminUser, { username: "x", password: "y", role: "user" }, undefined, undefined as never);
            return makeMutation() as ReturnType<typeof makeMutation>;
        });
        renderWithQuery(<UserFormDialog open mode="create" onOpenChange={onOpenChange} />);
        expect(toast.success).toHaveBeenCalledWith("User created successfully");
        expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it("toasts the error message when create fails", () => {
        setup();
        vi.mocked(users.useCreate).mockImplementation((opts) => {
            opts?.onError?.(new Error("username taken"), { username: "x", password: "y", role: "user" }, undefined, { client: {} as never, meta: undefined });
            return makeMutation() as ReturnType<typeof makeMutation>;
        });
        renderWithQuery(<UserFormDialog open mode="create" onOpenChange={vi.fn()} />);
        expect(toast.error).toHaveBeenCalledWith("username taken");
    });

    it("falls back to 'Create failed' toast when the error has no message", () => {
        setup();
        vi.mocked(users.useCreate).mockImplementation((opts) => {
            opts?.onError?.(new Error(""), { username: "x", password: "y", role: "user" }, undefined, { client: {} as never, meta: undefined });
            return makeMutation() as ReturnType<typeof makeMutation>;
        });
        renderWithQuery(<UserFormDialog open mode="create" onOpenChange={vi.fn()} />);
        expect(toast.error).toHaveBeenCalledWith("Create failed");
    });

    it("disables Cancel/Create and shows a spinner while createMutation.isPending", () => {
        vi.mocked(users.useCreate).mockReturnValue(makeMutation({ isPending: true }) as ReturnType<typeof makeMutation>);
        vi.mocked(users.useUpdate).mockReturnValue(makeMutation() as ReturnType<typeof makeMutation>);
        renderWithQuery(<UserFormDialog open mode="create" onOpenChange={vi.fn()} />);
        expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
        expect(screen.getByRole("button", { name: /Create/ })).toBeDisabled();
    });
});

describe("UserFormDialog — edit mode", () => {
    it("shows 'Edit user \"<username>\"' title", () => {
        renderWithQuery(<UserFormDialog open mode="edit" user={adminUser} onOpenChange={vi.fn()} />);
        expect(screen.getByText(`Edit user "${adminUser.username}"`)).toBeInTheDocument();
    });

    it("pre-fills username (disabled) and role from the user, leaves password blank", () => {
        renderWithQuery(<UserFormDialog open mode="edit" user={adminUser} onOpenChange={vi.fn()} />);
        const usernameInput = screen.getByLabelText("Username");
        expect(usernameInput).toHaveValue(adminUser.username);
        expect(usernameInput).toBeDisabled();
        expect(screen.getByLabelText("New Password")).toHaveValue("");
    });

    it("shows 'New Password' label and 'Leave blank to keep unchanged' placeholder", () => {
        renderWithQuery(<UserFormDialog open mode="edit" user={adminUser} onOpenChange={vi.fn()} />);
        expect(screen.getByPlaceholderText("Leave blank to keep unchanged")).toBeInTheDocument();
    });

    it("submits only { role } to updateMutation when password is left blank", async () => {
        const user = userEvent.setup();
        const { updateMut } = setup();
        renderWithQuery(<UserFormDialog open mode="edit" user={adminUser} onOpenChange={vi.fn()} />);
        await user.click(screen.getByRole("button", { name: "Save" }));
        expect(updateMut.mutate).toHaveBeenCalledWith({ id: adminUser.username, data: { role: "admin" } });
    });

    it("includes password in the update payload when typed", async () => {
        const user = userEvent.setup();
        const { updateMut } = setup();
        renderWithQuery(<UserFormDialog open mode="edit" user={adminUser} onOpenChange={vi.fn()} />);
        await user.type(screen.getByLabelText("New Password"), "newpass1");
        await user.click(screen.getByRole("button", { name: "Save" }));
        expect(updateMut.mutate).toHaveBeenCalledWith({
            id: adminUser.username,
            data: { role: "admin", password: "newpass1" },
        });
    });

    it("does not call updateMutation when user prop is null (defensive else-if)", async () => {
        const user = userEvent.setup();
        const { updateMut } = setup();
        renderWithQuery(<UserFormDialog open mode="edit" user={null} onOpenChange={vi.fn()} />);
        await user.click(screen.getByRole("button", { name: "Save" }));
        expect(updateMut.mutate).not.toHaveBeenCalled();
    });

    it("toasts success and closes the dialog when update succeeds", () => {
        const onOpenChange = vi.fn();
        setup();
        vi.mocked(users.useUpdate).mockImplementation((opts) => {
            opts?.onSuccess?.(adminUser, { id: "admin", data: { role: "admin" } }, undefined, undefined as never);
            return makeMutation() as ReturnType<typeof makeMutation>;
        });
        renderWithQuery(<UserFormDialog open mode="edit" user={adminUser} onOpenChange={onOpenChange} />);
        expect(toast.success).toHaveBeenCalledWith("User updated successfully");
        expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it("toasts the error message when update fails", () => {
        setup();
        vi.mocked(users.useUpdate).mockImplementation((opts) => {
            opts?.onError?.(new Error("forbidden"), { id: "admin", data: { role: "admin" } }, undefined, { client: {} as never, meta: undefined });
            return makeMutation() as ReturnType<typeof makeMutation>;
        });
        renderWithQuery(<UserFormDialog open mode="edit" user={adminUser} onOpenChange={vi.fn()} />);
        expect(toast.error).toHaveBeenCalledWith("forbidden");
    });

    it("falls back to 'Update failed' toast when the error has no message", () => {
        setup();
        vi.mocked(users.useUpdate).mockImplementation((opts) => {
            opts?.onError?.(new Error(""), { id: "admin", data: { role: "admin" } }, undefined, { client: {} as never, meta: undefined });
            return makeMutation() as ReturnType<typeof makeMutation>;
        });
        renderWithQuery(<UserFormDialog open mode="edit" user={adminUser} onOpenChange={vi.fn()} />);
        expect(toast.error).toHaveBeenCalledWith("Update failed");
    });

    it("resets the form fields when reopened for a different user", () => {
        const { rerender } = renderWithQuery(<UserFormDialog open mode="edit" user={adminUser} onOpenChange={vi.fn()} />);
        expect(screen.getByLabelText("Username")).toHaveValue("admin");
        rerender(<UserFormDialog open={false} mode="edit" user={adminUser} onOpenChange={vi.fn()} />);
        rerender(<UserFormDialog open mode="create" onOpenChange={vi.fn()} />);
        expect(screen.getByLabelText("Username")).toHaveValue("");
    });
});
