import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithClient, queryResult } from "./_helpers";
import type { LogListItemDTO } from "@/lib/schemas/log";
import type { Paginated } from "@/lib/schemas/common";

const useListMock = vi.fn();
vi.mock("@/lib/api/logs", () => ({
    logs: { useList: (q: unknown) => useListMock(q) },
}));

vi.mock("@/components/logs/logs-table", () => ({
    LogsTable: ({ data, onViewDetail }: { data: LogListItemDTO[]; onViewDetail: (id: string) => void }) => (
        <div data-testid="logs-table">
            {data.map((row) => (
                <button key={row.id} onClick={() => onViewDetail(row.id)}>
                    row-{row.id}
                </button>
            ))}
        </div>
    ),
}));
vi.mock("@/components/logs/log-details-lazy", () => ({
    LogDetails: ({ logId, open }: { logId: string | null; open: boolean }) => (
        <div data-testid="log-details" data-open={open} data-log-id={logId ?? ""} />
    ),
}));

import LogsPage from "@/app/(dashboard)/logs/page";

function row(overrides: Partial<LogListItemDTO> = {}): LogListItemDTO {
    return {
        id: "log-1",
        user_id: "u1",
        username: "alice",
        model_name: "gpt-4",
        capability: "chat",
        input_summary: "hi",
        status: "completed",
        input: "hi",
        output: "hello",
        reason: null,
        prompt_tokens: 5,
        completion_tokens: 5,
        total_tokens: 10,
        first_token_latency_ms: 50,
        total_latency_ms: 200,
        created_at: "2024-01-01T00:00:00.000Z",
        updated_at: "2024-01-01T00:00:00.000Z",
        is_deleted: false,
        ...overrides,
    };
}

function paginated(items: LogListItemDTO[], total = items.length): Paginated<LogListItemDTO> {
    return { items, total, page: 1, page_size: 20 };
}

describe("LogsPage", () => {
    beforeEach(() => {
        useListMock.mockReset();
    });

    it("shows the loading overlay only while loading with no cached data yet", () => {
        useListMock.mockReturnValue(queryResult<Paginated<LogListItemDTO>>({ data: undefined, isLoading: true }));
        renderWithClient(<LogsPage />);
        expect(screen.getByText(/loading/i)).toBeInTheDocument();
    });

    it("renders rows once loaded and opens the detail panel on view-detail", async () => {
        const user = userEvent.setup();
        useListMock.mockReturnValue(
            queryResult<Paginated<LogListItemDTO>>({ data: paginated([row()]), isLoading: false }),
        );
        renderWithClient(<LogsPage />);
        expect(screen.getByText("row-log-1")).toBeInTheDocument();

        await user.click(screen.getByText("row-log-1"));
        const details = screen.getByTestId("log-details");
        expect(details).toHaveAttribute("data-open", "true");
        expect(details).toHaveAttribute("data-log-id", "log-1");
    });

    it("applies user id / model name filters via the Filter button, passed through to logs.useList", async () => {
        const user = userEvent.setup();
        useListMock.mockReturnValue(
            queryResult<Paginated<LogListItemDTO>>({ data: paginated([]), isLoading: false }),
        );
        renderWithClient(<LogsPage />);

        await user.type(screen.getByPlaceholderText("User ID"), "u42");
        await user.type(screen.getByPlaceholderText("Model name"), "gpt-4");
        await user.click(screen.getByRole("button", { name: "Filter" }));

        const lastCall = useListMock.mock.calls.at(-1)?.[0];
        expect(lastCall).toMatchObject({ user_id: "u42", model_name: "gpt-4", status: null, page: 1 });
        // Reset button only shows once a filter is active.
        expect(screen.getByRole("button", { name: "Reset" })).toBeInTheDocument();
    });

    it("submits the filter via Enter keydown on an input", async () => {
        const user = userEvent.setup();
        useListMock.mockReturnValue(
            queryResult<Paginated<LogListItemDTO>>({ data: paginated([]), isLoading: false }),
        );
        renderWithClient(<LogsPage />);
        await user.type(screen.getByPlaceholderText("User ID"), "u9{Enter}");
        const lastCall = useListMock.mock.calls.at(-1)?.[0];
        expect(lastCall).toMatchObject({ user_id: "u9" });
    });

    it("clears filters and resets the Reset button visibility via handleClear", async () => {
        const user = userEvent.setup();
        useListMock.mockReturnValue(
            queryResult<Paginated<LogListItemDTO>>({ data: paginated([]), isLoading: false }),
        );
        renderWithClient(<LogsPage />);
        await user.type(screen.getByPlaceholderText("User ID"), "u42");
        await user.click(screen.getByRole("button", { name: "Filter" }));
        expect(screen.getByRole("button", { name: "Reset" })).toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "Reset" }));
        expect(screen.queryByRole("button", { name: "Reset" })).not.toBeInTheDocument();
        expect(screen.getByPlaceholderText("User ID")).toHaveValue("");
    });

    it("refetches via the refresh button", async () => {
        const user = userEvent.setup();
        const refetch = vi.fn();
        useListMock.mockReturnValue(
            queryResult<Paginated<LogListItemDTO>>({ data: paginated([row()]), isLoading: false, refetch }),
        );
        const { container } = renderWithClient(<LogsPage />);
        // RefreshButton has no accessible name (icon-only, aria-hidden svg,
        // tooltip content isn't wired to aria-label) — select by icon class.
        const refreshBtn = container.querySelector(".lucide-refresh-ccw")!.closest("button")!;
        await user.click(refreshBtn);
        expect(refetch).toHaveBeenCalledTimes(1);
    });

    it("filters by status via the Select, resetting to page 1", async () => {
        useListMock.mockReturnValue(
            queryResult<Paginated<LogListItemDTO>>({ data: paginated([]), isLoading: false }),
        );
        renderWithClient(<LogsPage />);
        // Radix Select trigger has no accessible name (combobox role
        // doesn't take name-from-content per ARIA spec, and there's no
        // aria-label) — disambiguate from the pagination page-size
        // Select by DOM order: status filter renders first.
        fireEvent.click(screen.getAllByRole("combobox")[0]);
        const option = await screen.findByText("Failed");
        fireEvent.click(option);

        const lastCall = useListMock.mock.calls.at(-1)?.[0];
        expect(lastCall).toMatchObject({ status: "failed", page: 1 });
    });
});
