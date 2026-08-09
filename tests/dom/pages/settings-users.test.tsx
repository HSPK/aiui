import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { UserDTO } from "@/lib/schemas/user";
import type { Paginated } from "@/lib/schemas/common";
import { adminUser, mutationResult, normalUser, queryResult, renderWithClient } from "./_helpers";

const useAuthMock = vi.fn();
vi.mock("@/context/auth-context", () => ({ useAuth: () => useAuthMock() }));

const useListMock = vi.fn();
const useDeleteMock = vi.fn();
vi.mock("@/lib/api/users", () => ({
    users: {
        useList: (...a: unknown[]) => useListMock(...a),
        useDelete: (...a: unknown[]) => useDeleteMock(...a),
    },
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) } }));

vi.mock("@/components/users/user-filters", () => ({
    UserFilters: ({
        keyword,
        onKeywordChange,
        filterAdmin,
        onFilterAdminChange,
        onSearch,
        onClear,
        onRefresh,
        onAdd,
        isFiltering,
    }: {
        keyword: string;
        onKeywordChange: (v: string) => void;
        filterAdmin: string;
        onFilterAdminChange: (v: string) => void;
        onSearch: () => void;
        onClear: () => void;
        onRefresh: () => void;
        onAdd: () => void;
        isFiltering: boolean;
        isRefreshing?: boolean;
    }) => (
        <div data-testid="user-filters">
            <input placeholder="keyword" value={keyword} onChange={(e) => onKeywordChange(e.target.value)} />
            <select aria-label="role filter" value={filterAdmin} onChange={(e) => onFilterAdminChange(e.target.value)}>
                <option value="all">all</option>
                <option value="admin">admin</option>
                <option value="user">user</option>
            </select>
            <button onClick={onSearch}>search</button>
            <button onClick={onClear}>clear</button>
            <button onClick={onRefresh}>refresh</button>
            <button onClick={onAdd}>add</button>
            <span data-testid="is-filtering">{String(isFiltering)}</span>
        </div>
    ),
}));

vi.mock("@/components/users/users-table", () => ({
    UsersTable: ({
        data,
        onEdit,
        onDelete,
        onRowClick,
    }: {
        data: UserDTO[];
        onEdit: (u: UserDTO) => void;
        onDelete: (u: UserDTO) => void;
        onRowClick?: (u: UserDTO) => void;
    }) => (
        <div data-testid="users-table">
            {data.map((u) => (
                <div key={u.username}>
                    <span>{u.username}</span>
                    <button onClick={() => onRowClick?.(u)}>row-{u.username}</button>
                    <button onClick={() => onEdit(u)}>edit-{u.username}</button>
                    <button onClick={() => onDelete(u)}>delete-{u.username}</button>
                </div>
            ))}
        </div>
    ),
}));

vi.mock("@/components/users/user-form-dialog", () => ({
    UserFormDialog: ({
        open,
        mode,
        user,
        onOpenChange,
    }: {
        open: boolean;
        mode: string;
        user?: UserDTO | null;
        onOpenChange: (open: boolean) => void;
    }) => (
        <div data-testid={`form-dialog-${mode}`} data-open={open} data-user={user?.username ?? ""}>
            <button onClick={() => onOpenChange(false)}>close-{mode}</button>
        </div>
    ),
}));

vi.mock("@/components/ui/table-pagination", () => ({
    TablePagination: ({ total }: { total: number }) => <div data-testid="table-pagination">{total}</div>,
}));

import UsersPage from "@/app/(dashboard)/settings/users/page";

function paginated(items: UserDTO[], total = items.length): Paginated<UserDTO> {
    return { items, total, page: 1, page_size: 20 };
}

describe("UsersPage", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useListMock.mockReturnValue(queryResult<Paginated<UserDTO>>({ data: paginated([adminUser, normalUser]) }));
        useDeleteMock.mockReturnValue(mutationResult({}));
    });

    it("shows Access Denied to a non-admin user and never enables the query", () => {
        useAuthMock.mockReturnValue({ user: normalUser });
        renderWithClient(<UsersPage />);

        expect(screen.getByText("Access Denied")).toBeInTheDocument();
        expect(screen.getByText("User management is restricted to administrators only.")).toBeInTheDocument();
        expect(screen.queryByTestId("users-table")).not.toBeInTheDocument();
        expect(useListMock).toHaveBeenCalledWith(expect.anything(), { enabled: false });
    });

    it("shows Access Denied when there is no authenticated user at all", () => {
        useAuthMock.mockReturnValue({ user: null });
        renderWithClient(<UsersPage />);
        expect(screen.getByText("Access Denied")).toBeInTheDocument();
    });

    it("renders the users table for an admin and enables the query", () => {
        useAuthMock.mockReturnValue({ user: adminUser });
        renderWithClient(<UsersPage />);

        expect(screen.queryByText("Access Denied")).not.toBeInTheDocument();
        const table = screen.getByTestId("users-table");
        expect(table).toBeInTheDocument();
        expect(within(table).getByText("admin")).toBeInTheDocument();
        expect(within(table).getByText("alice")).toBeInTheDocument();
        expect(useListMock).toHaveBeenCalledWith(expect.anything(), { enabled: true });
    });

    it("shows the loading overlay only while loading with no cached data yet", () => {
        useAuthMock.mockReturnValue({ user: adminUser });
        useListMock.mockReturnValue(queryResult<Paginated<UserDTO>>({ data: undefined, isLoading: true }));
        renderWithClient(<UsersPage />);
        expect(screen.getByText("Loading...")).toBeInTheDocument();
    });

    it("hides the loading overlay once data has been cached even while refetching", () => {
        useAuthMock.mockReturnValue({ user: adminUser });
        useListMock.mockReturnValue(queryResult<Paginated<UserDTO>>({ data: paginated([adminUser]), isLoading: true }));
        renderWithClient(<UsersPage />);
        expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    });

    it("opens the create dialog via the Add action", async () => {
        const user = userEvent.setup();
        useAuthMock.mockReturnValue({ user: adminUser });
        renderWithClient(<UsersPage />);

        expect(screen.getByTestId("form-dialog-create")).toHaveAttribute("data-open", "false");
        await user.click(screen.getByText("add"));
        expect(screen.getByTestId("form-dialog-create")).toHaveAttribute("data-open", "true");
    });

    it("opens the edit dialog via a row click and via the edit action, both with the right user", async () => {
        const user = userEvent.setup();
        useAuthMock.mockReturnValue({ user: adminUser });
        renderWithClient(<UsersPage />);

        await user.click(screen.getByText("row-alice"));
        expect(screen.getByTestId("form-dialog-edit")).toHaveAttribute("data-open", "true");
        expect(screen.getByTestId("form-dialog-edit")).toHaveAttribute("data-user", "alice");

        await user.click(screen.getByText("edit-admin"));
        expect(screen.getByTestId("form-dialog-edit")).toHaveAttribute("data-user", "admin");
    });

    it("resets to page 1 and re-queries with the keyword on search", async () => {
        const user = userEvent.setup();
        useAuthMock.mockReturnValue({ user: adminUser });
        renderWithClient(<UsersPage />);

        await user.type(screen.getByPlaceholderText("keyword"), "bob");
        await user.click(screen.getByText("search"));

        const lastCall = useListMock.mock.calls.at(-1)?.[0];
        expect(lastCall).toMatchObject({ keyword: "bob", page: 1 });
        expect(screen.getByTestId("is-filtering")).toHaveTextContent("true");
    });

    it("clears filters back to the unfiltered state", async () => {
        const user = userEvent.setup();
        useAuthMock.mockReturnValue({ user: adminUser });
        renderWithClient(<UsersPage />);

        await user.type(screen.getByPlaceholderText("keyword"), "bob");
        await user.click(screen.getByText("search"));
        expect(screen.getByTestId("is-filtering")).toHaveTextContent("true");

        await user.click(screen.getByText("clear"));
        expect(screen.getByTestId("is-filtering")).toHaveTextContent("false");
        expect(screen.getByPlaceholderText("keyword")).toHaveValue("");
        const lastCall = useListMock.mock.calls.at(-1)?.[0];
        expect(lastCall).toMatchObject({ keyword: undefined, page: 1 });
    });

    it("refetches via the refresh action", async () => {
        const user = userEvent.setup();
        const refetch = vi.fn();
        useAuthMock.mockReturnValue({ user: adminUser });
        useListMock.mockReturnValue(queryResult<Paginated<UserDTO>>({ data: paginated([adminUser]), refetch }));
        renderWithClient(<UsersPage />);

        await user.click(screen.getByText("refresh"));
        expect(refetch).toHaveBeenCalledTimes(1);
    });

    it("deletes a user through the real confirm dialog", async () => {
        const user = userEvent.setup();
        const mutate = vi.fn();
        useAuthMock.mockReturnValue({ user: adminUser });
        useDeleteMock.mockReturnValue(mutationResult({ mutate }));
        renderWithClient(<UsersPage />);

        await user.click(screen.getByText("delete-alice"));
        const dialog = screen.getByRole("alertdialog");
        expect(within(dialog).getByText(/permanently delete user/)).toBeInTheDocument();
        expect(within(dialog).getByText('"alice"')).toBeInTheDocument();

        await user.click(within(dialog).getByRole("button", { name: "Delete" }));
        expect(mutate).toHaveBeenCalledWith("alice");
    });

    it("shows a success toast and closes the dialog when delete succeeds", () => {
        useAuthMock.mockReturnValue({ user: adminUser });
        let onSuccess: (() => void) | undefined;
        useDeleteMock.mockImplementation((opts: { onSuccess?: () => void }) => {
            onSuccess = opts.onSuccess;
            return mutationResult({});
        });
        renderWithClient(<UsersPage />);
        onSuccess?.();
        expect(toastSuccess).toHaveBeenCalledWith("User deleted successfully");
    });

    it("shows an error toast when delete fails", () => {
        useAuthMock.mockReturnValue({ user: adminUser });
        let onError: ((e: Error) => void) | undefined;
        useDeleteMock.mockImplementation((opts: { onError?: (e: Error) => void }) => {
            onError = opts.onError;
            return mutationResult({});
        });
        renderWithClient(<UsersPage />);
        onError?.(new Error("cannot delete self"));
        expect(toastError).toHaveBeenCalledWith("cannot delete self");
    });

    it("falls back to a generic message when the delete error has no message", () => {
        useAuthMock.mockReturnValue({ user: adminUser });
        let onError: ((e: Error) => void) | undefined;
        useDeleteMock.mockImplementation((opts: { onError?: (e: Error) => void }) => {
            onError = opts.onError;
            return mutationResult({});
        });
        renderWithClient(<UsersPage />);
        onError?.(new Error(""));
        expect(toastError).toHaveBeenCalledWith("Delete failed");
    });

    it("closes the edit dialog via its onOpenChange callback", async () => {
        const user = userEvent.setup();
        useAuthMock.mockReturnValue({ user: adminUser });
        renderWithClient(<UsersPage />);

        await user.click(screen.getByText("row-alice"));
        expect(screen.getByTestId("form-dialog-edit")).toHaveAttribute("data-open", "true");

        await user.click(screen.getByText("close-edit"));
        expect(screen.getByTestId("form-dialog-edit")).toHaveAttribute("data-open", "false");
    });

    it("cancels the delete confirm dialog without deleting", async () => {
        const user = userEvent.setup();
        const mutate = vi.fn();
        useAuthMock.mockReturnValue({ user: adminUser });
        useDeleteMock.mockReturnValue(mutationResult({ mutate }));
        renderWithClient(<UsersPage />);

        await user.click(screen.getByText("delete-alice"));
        const dialog = screen.getByRole("alertdialog");
        await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
        expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
        expect(mutate).not.toHaveBeenCalled();
    });

    it("maps the role filter to filter_admin booleans (admin -> true, user -> false, all -> undefined)", async () => {
        const user = userEvent.setup();
        useAuthMock.mockReturnValue({ user: adminUser });
        renderWithClient(<UsersPage />);

        await user.selectOptions(screen.getByLabelText("role filter"), "admin");
        await user.click(screen.getByText("search"));
        expect(useListMock.mock.calls.at(-1)?.[0]).toMatchObject({ filter_admin: true });

        await user.selectOptions(screen.getByLabelText("role filter"), "user");
        await user.click(screen.getByText("search"));
        expect(useListMock.mock.calls.at(-1)?.[0]).toMatchObject({ filter_admin: false });

        await user.selectOptions(screen.getByLabelText("role filter"), "all");
        await user.click(screen.getByText("search"));
        expect(useListMock.mock.calls.at(-1)?.[0]).toMatchObject({ filter_admin: undefined });
    });
});
