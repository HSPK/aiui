import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";

import {
    SERIES_COLORS,
    OTHER_COLOR,
    RANGE_OPTIONS,
    CHART_TOOLTIP_STYLE,
    compactNumber,
    formatLatency,
    shortDay,
    modelColor,
    Kpi,
    RangePicker,
    EmptyState,
    StatsToolbar,
} from "@/components/dashboard/shared";

// ---- constants ----

describe("dashboard/shared constants", () => {
    it("exposes 8 series colors", () => {
        expect(SERIES_COLORS).toHaveLength(8);
    });

    it("exposes a distinct OTHER_COLOR", () => {
        expect(OTHER_COLOR).toBe("var(--muted-foreground, #64748b)");
        expect(SERIES_COLORS).not.toContain(OTHER_COLOR);
    });

    it("exposes 7d/14d/30d range options in order", () => {
        expect(RANGE_OPTIONS.map((r) => r.label)).toEqual(["7d", "14d", "30d"]);
        expect(RANGE_OPTIONS.map((r) => r.days)).toEqual([7, 14, 30]);
    });

    it("exposes a CHART_TOOLTIP_STYLE object matching the popover surface", () => {
        expect(CHART_TOOLTIP_STYLE).toMatchObject({
            background: "var(--popover)",
            border: "1px solid var(--border)",
            borderRadius: 8,
        });
    });
});

// ---- formatters ----

describe("compactNumber", () => {
    it("returns an em dash for null", () => expect(compactNumber(null)).toBe("—"));
    it("returns an em dash for undefined", () => expect(compactNumber(undefined)).toBe("—"));
    it("renders small numbers verbatim", () => expect(compactNumber(0)).toBe("0"));
    it("renders sub-1000 numbers verbatim", () => expect(compactNumber(742)).toBe("742"));
    it("renders 1k-9.9k with one decimal", () => expect(compactNumber(1500)).toBe("1.5k"));
    it("renders >=10k with no decimals", () => expect(compactNumber(15_000)).toBe("15k"));
    it("renders 1M-9.9M with one decimal", () => expect(compactNumber(1_500_000)).toBe("1.5M"));
    it("renders >=10M with no decimals", () => expect(compactNumber(12_000_000)).toBe("12M"));
});

describe("formatLatency", () => {
    it("returns an em dash for null", () => expect(formatLatency(null)).toBe("—"));
    it("returns an em dash for undefined", () => expect(formatLatency(undefined)).toBe("—"));
    it("renders sub-second latency in ms", () => expect(formatLatency(250)).toBe("250ms"));
    it("renders exactly-1000ms in seconds", () => expect(formatLatency(1000)).toBe("1.00s"));
    it("renders multi-second latency with 2 decimals", () => expect(formatLatency(2530)).toBe("2.53s"));
});

describe("shortDay", () => {
    it("formats an ISO date as 'Mon D' (UTC)", () => {
        expect(shortDay("2024-01-15")).toBe("Jan 15");
    });

    it("formats a December date correctly (no off-by-one across year boundary)", () => {
        expect(shortDay("2023-12-31")).toBe("Dec 31");
    });
});

describe("modelColor", () => {
    it("returns OTHER_COLOR for the '_other' key regardless of index", () => {
        expect(modelColor(3, "_other")).toBe(OTHER_COLOR);
    });

    it("returns the palette slot at `index` for a normal key", () => {
        expect(modelColor(0, "gpt-4o")).toBe(SERIES_COLORS[0]);
        expect(modelColor(2)).toBe(SERIES_COLORS[2]);
    });

    it("wraps around the palette when index exceeds its length", () => {
        expect(modelColor(SERIES_COLORS.length)).toBe(SERIES_COLORS[0]);
        expect(modelColor(SERIES_COLORS.length + 1)).toBe(SERIES_COLORS[1]);
    });
});

// ---- primitives ----

describe("Kpi", () => {
    function DummyIcon(props: React.SVGProps<SVGSVGElement>) {
        return <svg data-testid="dummy-icon" {...props} />;
    }

    it("renders label and value", () => {
        render(<Kpi label="Total requests" value={1234} icon={DummyIcon} />);
        expect(screen.getByText("Total requests")).toBeInTheDocument();
        expect(screen.getByText("1234")).toBeInTheDocument();
        expect(screen.getByTestId("dummy-icon")).toBeInTheDocument();
    });

    it("renders the optional sub caption when provided", () => {
        render(<Kpi label="Errors" value={5} sub="last 7 days" icon={DummyIcon} />);
        expect(screen.getByText("last 7 days")).toBeInTheDocument();
    });

    it("omits the sub caption entirely when not provided", () => {
        const { container } = render(<Kpi label="Errors" value={5} icon={DummyIcon} />);
        expect(container.querySelectorAll("p")).toHaveLength(0);
    });

    it("defaults to the 'default' tone styling", () => {
        const { container } = render(<Kpi label="X" value={1} icon={DummyIcon} />);
        expect(container.querySelector(".bg-primary\\/10")).toBeInTheDocument();
        expect(container.querySelector(".text-primary")).toBeInTheDocument();
    });

    it("applies 'danger' tone styling", () => {
        const { container } = render(<Kpi label="X" value={1} icon={DummyIcon} tone="danger" />);
        expect(container.querySelector(".bg-destructive\\/10")).toBeInTheDocument();
        expect(container.querySelector(".text-destructive")).toBeInTheDocument();
    });

    it("applies 'warn' tone styling", () => {
        const { container } = render(<Kpi label="X" value={1} icon={DummyIcon} tone="warn" />);
        expect(container.querySelector(".bg-amber-500\\/10")).toBeInTheDocument();
        expect(container.querySelector(".text-amber-500")).toBeInTheDocument();
    });
});

describe("RangePicker", () => {
    it("renders one button per RANGE_OPTIONS entry", () => {
        render(<RangePicker value={7} onChange={vi.fn()} />);
        expect(screen.getByRole("button", { name: "7d" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "14d" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "30d" })).toBeInTheDocument();
    });

    it("highlights the currently-selected value", () => {
        render(<RangePicker value={14} onChange={vi.fn()} />);
        expect(screen.getByRole("button", { name: "14d" })).toHaveClass("bg-secondary");
        expect(screen.getByRole("button", { name: "7d" })).not.toHaveClass("bg-secondary");
    });

    it("calls onChange with the clicked option's days", async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<RangePicker value={7} onChange={onChange} />);
        await user.click(screen.getByRole("button", { name: "30d" }));
        expect(onChange).toHaveBeenCalledWith(30);
    });
});

describe("EmptyState", () => {
    it("renders the given message", () => {
        render(<EmptyState message="No data for this range." />);
        expect(screen.getByText("No data for this range.")).toBeInTheDocument();
    });
});

describe("StatsToolbar", () => {
    it("shows 'Loading…' when windowStart/windowEnd are missing", () => {
        render(<StatsToolbar days={7} onDaysChange={vi.fn()} />);
        expect(screen.getByText("Loading…")).toBeInTheDocument();
    });

    it("shows the formatted window range when both dates are present", () => {
        render(<StatsToolbar windowStart="2024-01-01" windowEnd="2024-01-07" days={7} onDaysChange={vi.fn()} />);
        expect(screen.getByText("2024-01-01")).toBeInTheDocument();
        expect(screen.getByText("2024-01-07")).toBeInTheDocument();
        expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
    });

    it("renders the optional leadingNote before the range text", () => {
        render(
            <StatsToolbar
                windowStart="2024-01-01"
                windowEnd="2024-01-07"
                days={7}
                onDaysChange={vi.fn()}
                leadingNote="gpt-4o-mini"
            />,
        );
        expect(screen.getByText("gpt-4o-mini")).toBeInTheDocument();
    });

    it("shows a spinner only while isFetching is true", () => {
        const { container, rerender } = render(
            <StatsToolbar windowStart="2024-01-01" windowEnd="2024-01-07" days={7} onDaysChange={vi.fn()} isFetching />,
        );
        expect(container.querySelector("svg.animate-spin")).toBeInTheDocument();

        rerender(
            <StatsToolbar
                windowStart="2024-01-01"
                windowEnd="2024-01-07"
                days={7}
                onDaysChange={vi.fn()}
                isFetching={false}
            />,
        );
        expect(container.querySelector("svg.animate-spin")).not.toBeInTheDocument();
    });

    it("embeds a working RangePicker wired to onDaysChange", async () => {
        const user = userEvent.setup();
        const onDaysChange = vi.fn();
        render(
            <StatsToolbar
                windowStart="2024-01-01"
                windowEnd="2024-01-07"
                days={7}
                onDaysChange={onDaysChange}
            />,
        );
        await user.click(screen.getByRole("button", { name: "14d" }));
        expect(onDaysChange).toHaveBeenCalledWith(14);
    });
});
