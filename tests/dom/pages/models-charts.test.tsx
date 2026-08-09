import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { ErrorRateCard, LatencyCard, UsageTrendCard } from "@/app/(dashboard)/models/[name]/_parts/charts";

// recharts can't meaningfully lay out in jsdom. Mock it with passthrough
// containers, but *invoke* the formatter/tickFormatter/domain callback props
// synchronously so the page's inline formatting closures are exercised (and
// their branch coverage recorded), not merely skipped.
vi.mock("recharts", () => {
    const Passthrough = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
    return {
        ResponsiveContainer: Passthrough,
        BarChart: Passthrough,
        AreaChart: Passthrough,
        LineChart: Passthrough,
        CartesianGrid: () => null,
        Bar: () => null,
        Area: () => null,
        Line: () => null,
        Legend: (props: { formatter?: (v: string) => unknown }) => (
            <div data-testid="legend">
                {props.formatter ? [props.formatter("success"), props.formatter("failed"), props.formatter("first"), props.formatter("total")].join(",") : null}
            </div>
        ),
        XAxis: (props: { tickFormatter?: (v: unknown) => unknown }) => (
            <div data-testid="xaxis">{props.tickFormatter ? String(props.tickFormatter("2024-01-05")) : null}</div>
        ),
        YAxis: (props: { tickFormatter?: (v: unknown) => unknown; domain?: unknown[] }) => {
            const domainFn = Array.isArray(props.domain) ? props.domain[1] : undefined;
            const domainResult = typeof domainFn === "function" ? domainFn(3) : null;
            return (
                <div data-testid="yaxis">
                    {props.tickFormatter ? String(props.tickFormatter(1234)) : null}|{String(domainResult)}
                </div>
            );
        },
        Tooltip: (props: {
            labelFormatter?: (l: string) => unknown;
            formatter?: (v: unknown, n: unknown, item?: unknown) => unknown;
        }) => {
            const label = props.labelFormatter ? props.labelFormatter("2024-01-06") : null;
            const combos = props.formatter
                ? [
                      props.formatter(42, "success", { payload: { failed: 2, requests: 10 } }),
                      props.formatter(42, "failed", { payload: { failed: 2, requests: 10 } }),
                      props.formatter(null, "first", { payload: {} }),
                      props.formatter(55, "total", { payload: {} }),
                  ]
                : [];
            return (
                <div data-testid="tooltip">
                    {String(label)}|{JSON.stringify(combos)}
                </div>
            );
        },
    };
});

describe("UsageTrendCard", () => {
    it("shows the empty state when there is no data and not loading", () => {
        render(<UsageTrendCard trend={[]} hasData={false} isLoading={false} error={null} />);
        expect(screen.getByText("No requests in window")).toBeInTheDocument();
    });

    it("shows a failure message in the empty state when there is an error", () => {
        render(<UsageTrendCard trend={[]} hasData={false} isLoading={false} error={new Error("boom")} />);
        expect(screen.getByText("Failed to load")).toBeInTheDocument();
    });

    it("renders the chart (and exercises its formatter props) when data is present", () => {
        render(
            <UsageTrendCard
                trend={[{ day: "2024-01-01", requests: 10, failed: 2 }]}
                hasData
                isLoading={false}
                error={null}
            />
        );
        expect(screen.getByTestId("tooltip")).toBeInTheDocument();
        expect(screen.getByTestId("legend").textContent).toContain("Success");
        expect(screen.getByTestId("legend").textContent).toContain("Failed");
    });

    it("renders the chart while still loading if data was already present", () => {
        render(
            <UsageTrendCard
                trend={[{ day: "2024-01-01", requests: 10, failed: 2 }]}
                hasData
                isLoading
                error={null}
            />
        );
        expect(screen.getByTestId("tooltip")).toBeInTheDocument();
    });
});

describe("ErrorRateCard", () => {
    it("shows the empty state when there is no data", () => {
        render(<ErrorRateCard errorTrend={[]} hasData={false} isLoading={false} />);
        expect(screen.getByText("No data")).toBeInTheDocument();
    });

    it("renders the chart and exercises the domain + formatter callbacks", () => {
        render(
            <ErrorRateCard
                errorTrend={[{ day: "2024-01-01", rate: 12.3, failed: 1, requests: 8 }]}
                hasData
                isLoading={false}
            />
        );
        const yaxis = screen.getByTestId("yaxis");
        // Math.max(5, Math.ceil(3 + 1)) === 5
        expect(yaxis.textContent).toContain("|5");
        expect(screen.getByTestId("tooltip")).toBeInTheDocument();
    });
});

describe("LatencyCard", () => {
    it("shows the empty state when there is no data", () => {
        render(<LatencyCard latencyTrend={[]} hasData={false} isLoading={false} />);
        expect(screen.getByText("No data")).toBeInTheDocument();
    });

    it("renders the chart and exercises the TTFT/Total formatter + legend branches", () => {
        render(
            <LatencyCard
                latencyTrend={[{ day: "2024-01-01", first: 120, total: 400 }]}
                hasData
                isLoading={false}
            />
        );
        expect(screen.getByTestId("legend").textContent).toContain("TTFT");
        expect(screen.getByTestId("legend").textContent).toContain("Total");
        // formatter(null, "first", ...) exercises the `value == null` branch.
        expect(screen.getByTestId("tooltip").textContent).toContain("\u2014");
    });
});
