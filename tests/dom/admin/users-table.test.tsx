import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";

import { renderWithQuery } from "./_render";
import { adminUser, normalUser } from "./_fixtures";
import { UsersTable } from "@/components/users/users-table";
import { formatToLocal } from "@/lib/utils";
import type { SortingState } from "@tanstack/react-table";

function setup(overrides: Partial<ComponentProps<typeof UsersTable>> = {}) {
    const onSortingChange = vi.fn();
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    const onRowClick = vi.fn();
    const props = {
        data: [adminUser, normalUser],
        sorting: [] as SortingState,
        onSortingChange,
        currentUser: adminUser,
        onEdit,
        onDelete,
        onRowClick,
        ...overrides,
    };
    const view = renderWithQuery(<UsersTable {...props} />);
    return { ...view, onSortingChange, onEdit, onDelete, onRowClick, props };
}

describe("UsersTable", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("renders 'No users found.' when data is empty", () => {
        setup({ data: [] });
        expect(screen.getByText("No users found.")).toBeInTheDocument();
    });

    it("renders a row per user with username and formatted created_at", () => {
        setup();
        // "admin" appears twice by coincidence of the fixture: once as
        // adminUser's username, once as their role badge text.
        expect(screen.getAllByText("admin")).toHaveLength(2);
        expect(screen.getByText("bob")).toBeInTheDocument();
        expect(screen.getByText(formatToLocal(adminUser.created_at!, "MMM d, HH:mm:ss"))).toBeInTheDocument();
        expect(screen.getByText(formatToLocal(normalUser.created_at!, "MMM d, HH:mm:ss"))).toBeInTheDocument();
    });

    it("renders '-' for a missing created_at", () => {
        setup({ data: [{ ...adminUser, created_at: undefined }] });
        expect(screen.getByText("-")).toBeInTheDocument();
    });

    it("shows the 'me' badge only for the row matching currentUser", () => {
        setup({ currentUser: adminUser });
        expect(screen.getByText("me")).toBeInTheDocument();
    });

    it("shows no 'me' badge when currentUser is null", () => {
        setup({ currentUser: null });
        expect(screen.queryByText("me")).not.toBeInTheDocument();
    });

    it("renders the admin role badge with a Shield icon", () => {
        const { container } = setup({ data: [adminUser] });
        expect(container.querySelector(".lucide-shield")).toBeInTheDocument();
        expect(container.querySelector(".lucide-user")).not.toBeInTheDocument();
    });

    it("renders the user role badge with 'user' text", () => {
        setup({ data: [normalUser] });
        expect(screen.getByText("user")).toBeInTheDocument();
    });

    it("clicking the Username header toggles sorting ascending from empty state", async () => {
        const user = userEvent.setup();
        const { onSortingChange } = setup({ sorting: [] });
        await user.click(screen.getByRole("button", { name: /Username/i }));
        expect(onSortingChange).toHaveBeenCalledWith([{ id: "username", desc: false }]);
    });

    it("clicking the Username header toggles to descending when already ascending", async () => {
        const user = userEvent.setup();
        const { onSortingChange } = setup({ sorting: [{ id: "username", desc: false }] });
        await user.click(screen.getByRole("button", { name: /Username/i }));
        expect(onSortingChange).toHaveBeenCalledWith([{ id: "username", desc: true }]);
    });

    it("clicking the Created header sorts by created_at", async () => {
        const user = userEvent.setup();
        const { onSortingChange } = setup({ sorting: [] });
        await user.click(screen.getByRole("button", { name: /Created/i }));
        expect(onSortingChange).toHaveBeenCalledWith([{ id: "created_at", desc: false }]);
    });

    it("clicking a row calls onRowClick with that user", async () => {
        const user = userEvent.setup();
        const { onRowClick } = setup();
        await user.click(screen.getByText("bob"));
        expect(onRowClick).toHaveBeenCalledWith(normalUser);
    });

    it("does not throw when onRowClick is omitted and a row is clicked", async () => {
        const user = userEvent.setup();
        setup({ onRowClick: undefined });
        await user.click(screen.getByText("bob"));
        // no assertion needed beyond "did not throw" — optional chaining guard
    });

    it("opens the row actions menu and Edit calls onEdit with that user", async () => {
        const user = userEvent.setup();
        const { onEdit } = setup();
        const menus = screen.getAllByRole("button", { name: /open menu/i });
        await user.click(menus[1]);
        await user.click(await screen.findByText("Edit"));
        expect(onEdit).toHaveBeenCalledWith(normalUser);
    });

    it("Delete in the row menu calls onDelete for a non-current-user row", async () => {
        const user = userEvent.setup();
        const { onDelete } = setup();
        const menus = screen.getAllByRole("button", { name: /open menu/i });
        await user.click(menus[1]);
        await user.click(await screen.findByText("Delete"));
        expect(onDelete).toHaveBeenCalledWith(normalUser);
    });

    it("disables Delete for the row matching currentUser (can't delete yourself)", async () => {
        const user = userEvent.setup();
        setup({ currentUser: adminUser });
        const menus = screen.getAllByRole("button", { name: /open menu/i });
        await user.click(menus[0]);
        const deleteItem = await screen.findByRole("menuitem", { name: /delete/i });
        expect(deleteItem).toHaveAttribute("aria-disabled", "true");
    });
});
