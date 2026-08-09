import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { renderWithClient, queryResult, makeRouter } from "./_helpers";
import type { StatsOverviewDTO } from "@/lib/schemas/stats";

const useOverviewMock = vi.fn();
vi.mock("@/lib/api/stats", () => ({
    stats: { useOverview: (q: unknown) => useOverviewMock(q) },
}));

const routerMock = makeRouter();
vi.mock("next/navigation", () => ({
    useRouter: () => routerMock,
}));

// recharts renders real SVG via ResizeObserver-driven layout, which
// jsdom cannot do meaningfully. Stub it with passthrough containers +
// a Tooltip that actually *invokes* the page's `content`/`formatter`
// render-prop with fixture data, so the page's own tooltip-formatting
// logic (SegmentTooltip, inline formatters) is still exercised.
vi.mock("recharts", () => ({
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    BarChart: ({ children }: { children: React.ReactNode }) => <div data-testid="bar-chart">{children}</div>,
    PieChart: ({ children }: { children: React.ReactNode }) => <div data-testid="pie-chart">{children}</div>,
    Pie: ({ children }: { children: React.ReactNode }) => <div data-testid="pie">{children}</div>,
    Cell: () => null,
    XAxis: () => null,
    YAxis: () => null,
    CartesianGrid: () => null,
    Bar: (props: {
        dataKey: string;
        onClick?: (d: unknown) => void;
        onMouseEnter?: () => void;
        onMouseLeave?: () => void;
    }) => (
        <div
            data-testid={`bar-${props.dataKey}`}
            // Stacked-usage bars (dataKey = model id) call onClick with no
            // args (closure already has `m`); the "Top models" bar
            // (dataKey = "requests") expects the clicked row object with a
            // `.key` — fixture below always has a lone "gpt-4" row.
            onClick={() => props.onClick?.(props.dataKey === "requests" ? { key: "gpt-4" } : undefined)}
            onMouseEnter={() => props.onMouseEnter?.()}
            onMouseLeave={() => props.onMouseLeave?.()}
        />
    ),
    Tooltip: (props: {
        content?: (p: unknown) => React.ReactNode;
        formatter?: (value: unknown, name?: unknown) => [React.ReactNode, React.ReactNode];
    }) => {
        if (typeof props.content === "function") {
            return (
                <div data-testid="tooltip-content">
                    {props.content({
                        active: true,
                        label: "2024-01-02",
                        payload: [
                            { name: "gpt-4", value: 5, color: "#fff", dataKey: "gpt-4" },
                            { name: "_other", value: 0, color: "#000", dataKey: "_other" },
                        ],
                    })}
                </div>
            );
        }
        if (typeof props.formatter === "function") {
            const [v, n] = props.formatter(7, "requests");
            return <div data-testid="tooltip-formatter">{v} {n}</div>;
        }
        return null;
    },
}));

import DashboardPage from "@/app/(dashboard)/page";

function overview(overrides: Partial<StatsOverviewDTO> = {}): StatsOverviewDTO {
    return {
        window_start: "2024-01-01",
        window_end: "2024-01-14",
        days: 14,
        totals: {
            requests: 100,
            completed: 90,
            failed: 10,
            pending: 0,
            prompt_tokens: 1000,
            completion_tokens: 2000,
            total_tokens: 3000,
            avg_first_token_latency_ms: 120,
            avg_total_latency_ms: 900,
        },
        trend: [{ day: "2024-01-02", requests: 5, prompt_tokens: 10, completion_tokens: 20, total_tokens: 30, failed: 0 }],
        trend_by_model: [{ day: "2024-01-02", model: "gpt-4", requests: 5 }],
        trend_models: ["gpt-4", "_other"],
        by_capability: [{ key: "chat", label: "Chat", requests: 80, total_tokens: 2500 }],
        by_model: [{ key: "gpt-4", label: "gpt-4", requests: 80, total_tokens: 2500 }],
        ...overrides,
    };
}

describe("DashboardPage", () => {
    beforeEach(() => {
        useOverviewMock.mockReset();
        routerMock.push.mockReset();
    });

    it("shows a loading empty-state for every chart while the query is pending", () => {
        useOverviewMock.mockReturnValue(queryResult<StatsOverviewDTO>({ data: undefined, isLoading: true }));
        renderWithClient(<DashboardPage />);
        expect(screen.getAllByText("Loading…").length).toBeGreaterThan(0);
        // KPIs render em-dash placeholders when totals is undefined.
        expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    });

    it("shows a 'No data' empty-state once loaded with empty buckets", () => {
        useOverviewMock.mockReturnValue(
            queryResult<StatsOverviewDTO>({
                data: overview({ trend_models: [], by_capability: [], by_model: [] }),
                isLoading: false,
            }),
        );
        renderWithClient(<DashboardPage />);
        expect(screen.getAllByText("No data").length).toBe(3);
    });

    it("renders KPI values, error-rate danger tone, and the charts once data loads", () => {
        useOverviewMock.mockReturnValue(queryResult<StatsOverviewDTO>({ data: overview(), isLoading: false }));
        renderWithClient(<DashboardPage />);

        expect(screen.getByText("100")).toBeInTheDocument(); // requests
        expect(screen.getByText("3.0k")).toBeInTheDocument(); // total tokens compacted
        expect(screen.getByText("900ms")).toBeInTheDocument();
        expect(screen.getByText("10%")).toBeInTheDocument(); // errorRate = 10/100*100
        expect(screen.getAllByTestId("bar-chart").length).toBe(2);
        expect(screen.getByTestId("pie-chart")).toBeInTheDocument();
        // Stacked-usage tooltip content renders via SegmentTooltip with
        // the fixture payload (only the positive-value gpt-4 entry).
        expect(screen.getByTestId("tooltip-content")).toHaveTextContent("gpt-4");
    });

    it("navigates to the model dashboard when a stacked-usage bar segment is clicked", () => {
        useOverviewMock.mockReturnValue(queryResult<StatsOverviewDTO>({ data: overview(), isLoading: false }));
        renderWithClient(<DashboardPage />);
        fireEvent.click(screen.getByTestId("bar-gpt-4"));
        expect(routerMock.push).toHaveBeenCalledWith("/models/gpt-4");
    });

    it("does not navigate when the synthetic _other segment is clicked", () => {
        useOverviewMock.mockReturnValue(queryResult<StatsOverviewDTO>({ data: overview(), isLoading: false }));
        renderWithClient(<DashboardPage />);
        fireEvent.click(screen.getByTestId("bar-_other"));
        expect(routerMock.push).not.toHaveBeenCalled();
    });

    it("navigates to the model dashboard when a top-models row is clicked", () => {
        useOverviewMock.mockReturnValue(queryResult<StatsOverviewDTO>({ data: overview(), isLoading: false }));
        renderWithClient(<DashboardPage />);
        fireEvent.click(screen.getByTestId("bar-requests"));
        expect(routerMock.push).toHaveBeenCalledWith("/models/gpt-4");
    });

    it("tracks hovered segment via onMouseEnter/onMouseLeave without throwing", () => {
        useOverviewMock.mockReturnValue(queryResult<StatsOverviewDTO>({ data: overview(), isLoading: false }));
        renderWithClient(<DashboardPage />);
        const bar = screen.getByTestId("bar-gpt-4");
        fireEvent.mouseEnter(bar);
        fireEvent.mouseLeave(bar);
    });
});
