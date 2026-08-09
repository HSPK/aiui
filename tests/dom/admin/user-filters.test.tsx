import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";

import { renderWithQuery } from "./_render";
import { UserFilters } from "@/components/users/user-filters";

function setup(overrides: Partial<ComponentProps<typeof UserFilters>> = {}) {
    const onKeywordChange = vi.fn();
    const onFilterAdminChange = vi.fn();
    const onSearch = vi.fn();
    const onClear = vi.fn();
    const onRefresh = vi.fn();
    const onAdd = vi.fn();
    const props = {
        keyword: "",
        onKeywordChange,
        filterAdmin: "all",
        onFilterAdminChange,
        onSearch,
        onClear,
        onRefresh,
        onAdd,
        isFiltering: false,
        ...overrides,
    };
    const view = renderWithQuery(<UserFilters {...props} />);
    return { ...view, onKeywordChange, onFilterAdminChange, onSearch, onClear, onRefresh, onAdd };
}

describe("UserFilters", () => {
    it("renders the username input with the current keyword value", () => {
        setup({ keyword: "alice" });
        expect(screen.getByPlaceholderText("Username")).toHaveValue("alice");
    });

    it("calls onKeywordChange as the user types", async () => {
        const user = userEvent.setup();
        const { onKeywordChange } = setup();
        await user.type(screen.getByPlaceholderText("Username"), "x");
        expect(onKeywordChange).toHaveBeenCalledWith("x");
    });

    it("calls onSearch when Enter is pressed in the username input", async () => {
        const user = userEvent.setup();
        const { onSearch } = setup();
        await user.type(screen.getByPlaceholderText("Username"), "{Enter}");
        expect(onSearch).toHaveBeenCalled();
    });

    it("does not call onSearch for a non-Enter keydown", async () => {
        const user = userEvent.setup();
        const { onSearch } = setup();
        await user.type(screen.getByPlaceholderText("Username"), "a");
        expect(onSearch).not.toHaveBeenCalled();
    });

    it("clicking the Filter button calls onSearch", async () => {
        const user = userEvent.setup();
        const { onSearch } = setup();
        await user.click(screen.getByRole("button", { name: "Filter" }));
        expect(onSearch).toHaveBeenCalled();
    });

    it("hides the Reset button when isFiltering is false", () => {
        setup({ isFiltering: false });
        expect(screen.queryByRole("button", { name: "Reset" })).not.toBeInTheDocument();
    });

    it("shows the Reset button when isFiltering is true, and it calls onClear", async () => {
        const user = userEvent.setup();
        const { onClear } = setup({ isFiltering: true });
        const resetBtn = screen.getByRole("button", { name: "Reset" });
        await user.click(resetBtn);
        expect(onClear).toHaveBeenCalled();
    });

    it("changing the role Select calls onFilterAdminChange", async () => {
        const user = userEvent.setup();
        const { onFilterAdminChange } = setup();
        await user.click(screen.getByRole("combobox"));
        await user.click(await screen.findByRole("option", { name: "Admin" }));
        expect(onFilterAdminChange).toHaveBeenCalledWith("admin");
    });

    it("clicking the refresh button calls onRefresh", async () => {
        const user = userEvent.setup();
        const { container, onRefresh } = setup();
        // RefreshButton is icon-only with no accessible name; target it via
        // its lucide icon class instead of role/name.
        const refreshBtn = container.querySelector(".lucide-refresh-ccw")!.closest("button")!;
        await user.click(refreshBtn);
        expect(onRefresh).toHaveBeenCalled();
    });

    it("shows a loading spinner and disables the refresh button when isRefreshing", () => {
        const { container } = setup({ isRefreshing: true });
        // lucide-react's `Loader2` export is an alias for the `loader-circle` icon.
        const refreshBtn = container.querySelector(".lucide-loader-circle")!.closest("button")!;
        expect(refreshBtn).toBeDisabled();
        expect(container.querySelector(".lucide-refresh-ccw")).not.toBeInTheDocument();
    });

    it("clicking 'Add User' calls onAdd", async () => {
        const user = userEvent.setup();
        const { onAdd } = setup();
        await user.click(screen.getByRole("button", { name: /add user/i }));
        expect(onAdd).toHaveBeenCalled();
    });
});
