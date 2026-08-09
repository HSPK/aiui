import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cn, formatMessageTime, formatRelativeDate, formatToLocal, normalizeDate } from "@/lib/utils";

describe("cn", () => {
    it("joins plain string class names with a space", () => {
        expect(cn("a", "b")).toBe("a b");
    });

    it("drops falsy values (false, null, undefined, empty string)", () => {
        expect(cn("a", false && "b", null, undefined, "", "c")).toBe("a c");
    });

    it("expands object syntax, keeping only truthy keys", () => {
        expect(cn({ "text-red-500": true, "text-blue-500": false })).toBe("text-red-500");
    });

    it("flattens arrays of class names", () => {
        expect(cn(["a", "b"], "c")).toBe("a b c");
    });

    it("resolves conflicting tailwind utility classes, keeping the last one", () => {
        expect(cn("p-2", "p-4")).toBe("p-4");
    });

    it("returns an empty string when given nothing usable", () => {
        expect(cn()).toBe("");
        expect(cn(null, undefined, false)).toBe("");
    });
});

describe("normalizeDate", () => {
    it("returns a fresh Date close to now when given undefined", () => {
        const before = Date.now();
        const result = normalizeDate(undefined);
        const after = Date.now();
        expect(result).toBeInstanceOf(Date);
        expect(result.getTime()).toBeGreaterThanOrEqual(before);
        expect(result.getTime()).toBeLessThanOrEqual(after);
    });

    it("returns a fresh Date close to now when given an empty string", () => {
        const result = normalizeDate("");
        expect(result).toBeInstanceOf(Date);
        expect(Math.abs(result.getTime() - Date.now())).toBeLessThan(2000);
    });

    it("returns the exact same Date instance when passed a Date", () => {
        const date = new Date("2024-01-01T00:00:00.000Z");
        expect(normalizeDate(date)).toBe(date);
    });

    it("appends Z to a naive timestamp string with no timezone marker", () => {
        const result = normalizeDate("2024-03-01T10:20:30");
        expect(result.toISOString()).toBe("2024-03-01T10:20:30.000Z");
    });

    it("uses a Z-suffixed string as-is", () => {
        const result = normalizeDate("2024-03-01T10:20:30Z");
        expect(result.toISOString()).toBe("2024-03-01T10:20:30.000Z");
    });

    it("uses a string with an explicit +HH:MM offset as-is (no extra Z appended)", () => {
        const result = normalizeDate("2024-03-01T10:20:30+02:00");
        expect(result.toISOString()).toBe("2024-03-01T08:20:30.000Z");
    });

    it("uses a string with an explicit -HH:MM offset as-is", () => {
        const result = normalizeDate("2024-03-01T10:20:30-05:00");
        expect(result.toISOString()).toBe("2024-03-01T15:20:30.000Z");
    });

    it("parses a bare YYYY-MM-DD date correctly (UTC midnight either way)", () => {
        const result = normalizeDate("2024-03-01");
        expect(result.toISOString()).toBe("2024-03-01T00:00:00.000Z");
    });
});

describe("formatToLocal", () => {
    it("returns '-' for an empty string", () => {
        expect(formatToLocal("")).toBe("-");
    });

    it("formats a Z-suffixed timestamp with the default pattern", () => {
        expect(formatToLocal("2024-03-01T10:20:30Z")).toBe("Mar 1, 10:20:30");
    });

    it("appends Z before formatting a naive timestamp", () => {
        expect(formatToLocal("2024-03-01T10:20:30")).toBe("Mar 1, 10:20:30");
    });

    it("honours a custom format pattern", () => {
        expect(formatToLocal("2024-03-01T10:20:30Z", "yyyy-MM-dd")).toBe("2024-03-01");
    });
});

describe("formatMessageTime", () => {
    it("formats a given date as HH:mm", () => {
        expect(formatMessageTime("2024-03-01T10:20:30Z")).toBe("10:20");
    });

    it("formats the current time when no argument is given", () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2024-03-01T10:20:30Z"));
        try {
            expect(formatMessageTime()).toBe("10:20");
        } finally {
            vi.useRealTimers();
        }
    });
});

describe("formatRelativeDate", () => {
    const NOW = "2024-06-15T12:00:00Z";

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(NOW));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("returns 'Today' for a timestamp on the current UTC day", () => {
        expect(formatRelativeDate("2024-06-15T00:30:00Z")).toBe("Today");
    });

    it("returns 'Yesterday' for a timestamp on the previous UTC day", () => {
        expect(formatRelativeDate("2024-06-14T23:00:00Z")).toBe("Yesterday");
    });

    it("returns 'MMMM d' for an older date within the same year", () => {
        expect(formatRelativeDate("2024-01-05T00:00:00Z")).toBe("January 5");
    });

    it("returns 'MMMM d, yyyy' for a date in a previous year", () => {
        expect(formatRelativeDate("2022-03-10T00:00:00Z")).toBe("March 10, 2022");
    });

    it("defaults to 'now' when no argument is given", () => {
        expect(formatRelativeDate()).toBe("Today");
    });
});
