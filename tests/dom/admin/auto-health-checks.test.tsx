import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "@testing-library/react";

import { renderWithQuery } from "./_render";
import { AutoHealthChecks } from "@/components/AutoHealthChecks";

type McpRow = { id: string; enabled: boolean; last_check_at: string | null };
type ProviderRow = {
    id: string;
    enabled: boolean;
    health_check_url: string | null;
    last_health_checked_at: string | null;
};

const mcpListMock = vi.fn<() => { data: McpRow[] | undefined }>(() => ({ data: [] }));
const mcpCheckMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/api/mcp", () => ({
    mcpServers: {
        useList: () => mcpListMock(),
        check: (id: string) => mcpCheckMock(id),
    },
}));

const providerListMock = vi.fn<() => { data: ProviderRow[] | undefined }>(() => ({ data: [] }));
const providerCheckMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/api/providers", () => ({
    providers: {
        useList: () => providerListMock(),
        check: (id: string) => providerCheckMock(id),
    },
}));

const prefsGetMock = vi.fn(() => ({
    data: { mcp_auto_check_interval_minutes: 0, provider_auto_check_interval_minutes: 0 },
}));
vi.mock("@/lib/api/preferences", () => ({
    preferences: { useGet: () => prefsGetMock() },
}));

beforeEach(() => {
    vi.useFakeTimers();
    mcpListMock.mockReturnValue({ data: [] });
    providerListMock.mockReturnValue({ data: [] });
    mcpCheckMock.mockReset().mockResolvedValue(undefined);
    providerCheckMock.mockReset().mockResolvedValue(undefined);
    prefsGetMock.mockReturnValue({
        data: { mcp_auto_check_interval_minutes: 0, provider_auto_check_interval_minutes: 0 },
    });
});

afterEach(() => {
    vi.useRealTimers();
});

/** Advances fake timers while keeping React's act() scope so any state
 *  updates from resolved promises (sweep loop awaits) are flushed. */
async function advance(ms: number) {
    await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
    });
}

describe("AutoHealthChecks — on-mount sweep", () => {
    it("probes an enabled MCP server whose last_check_at is null (post-boot wipe)", async () => {
        mcpListMock.mockReturnValue({
            data: [{ id: "m1", enabled: true, last_check_at: null }],
        });
        const { queryClient } = renderWithQuery(<AutoHealthChecks />);
        const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

        await advance(200);

        expect(mcpCheckMock).toHaveBeenCalledWith("m1");
        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["mcp-servers"] });
    });

    it("skips MCP servers that already have a last_check_at timestamp", async () => {
        mcpListMock.mockReturnValue({
            data: [{ id: "m1", enabled: true, last_check_at: "2024-01-01T00:00:00Z" }],
        });
        renderWithQuery(<AutoHealthChecks />);

        await advance(200);

        expect(mcpCheckMock).not.toHaveBeenCalled();
    });

    it("excludes disabled MCP servers from the on-mount sweep", async () => {
        mcpListMock.mockReturnValue({
            data: [{ id: "m1", enabled: false, last_check_at: null }],
        });
        renderWithQuery(<AutoHealthChecks />);

        await advance(200);

        expect(mcpCheckMock).not.toHaveBeenCalled();
    });

    it("only auto-probes providers that have a health_check_url configured", async () => {
        providerListMock.mockReturnValue({
            data: [
                { id: "p1", enabled: true, health_check_url: "https://p1.example/health", last_health_checked_at: null },
                { id: "p2", enabled: true, health_check_url: null, last_health_checked_at: null },
            ],
        });
        const { queryClient } = renderWithQuery(<AutoHealthChecks />);
        const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

        await advance(200);

        expect(providerCheckMock).toHaveBeenCalledWith("p1");
        expect(providerCheckMock).not.toHaveBeenCalledWith("p2");
        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["providers"] });
    });

    it("excludes disabled providers even when a health_check_url is set", async () => {
        providerListMock.mockReturnValue({
            data: [{ id: "p1", enabled: false, health_check_url: "https://x", last_health_checked_at: null }],
        });
        renderWithQuery(<AutoHealthChecks />);

        await advance(200);

        expect(providerCheckMock).not.toHaveBeenCalled();
    });

    it("swallows a rejected check() so one failure doesn't break the sweep", async () => {
        mcpCheckMock.mockRejectedValueOnce(new Error("boom"));
        mcpListMock.mockReturnValue({
            data: [
                { id: "m1", enabled: true, last_check_at: null },
                { id: "m2", enabled: true, last_check_at: null },
            ],
        });
        renderWithQuery(<AutoHealthChecks />);

        await advance(300);

        expect(mcpCheckMock).toHaveBeenNthCalledWith(1, "m1");
        expect(mcpCheckMock).toHaveBeenNthCalledWith(2, "m2");
    });

    it("does nothing while the lists are still loading (undefined)", async () => {
        mcpListMock.mockReturnValue({ data: undefined });
        providerListMock.mockReturnValue({ data: undefined });
        renderWithQuery(<AutoHealthChecks />);

        await advance(200);

        expect(mcpCheckMock).not.toHaveBeenCalled();
        expect(providerCheckMock).not.toHaveBeenCalled();
    });
});

describe("AutoHealthChecks — interval sweep", () => {
    it("re-probes ALL enabled MCP servers every mcp_auto_check_interval_minutes, repeatedly", async () => {
        prefsGetMock.mockReturnValue({
            data: { mcp_auto_check_interval_minutes: 5, provider_auto_check_interval_minutes: 0 },
        });
        // Already checked once — the on-mount sweep should stay silent so
        // only the interval-driven calls are being counted below.
        mcpListMock.mockReturnValue({
            data: [{ id: "m1", enabled: true, last_check_at: "2024-01-01T00:00:00Z" }],
        });
        renderWithQuery(<AutoHealthChecks />);

        await advance(5 * 60_000 + 200);
        expect(mcpCheckMock).toHaveBeenCalledTimes(1);

        await advance(5 * 60_000 + 200);
        expect(mcpCheckMock).toHaveBeenCalledTimes(2);
    });

    it("re-probes providers on their own configured cadence", async () => {
        prefsGetMock.mockReturnValue({
            data: { mcp_auto_check_interval_minutes: 0, provider_auto_check_interval_minutes: 10 },
        });
        providerListMock.mockReturnValue({
            data: [{ id: "p1", enabled: true, health_check_url: "https://x", last_health_checked_at: "2024-01-01T00:00:00Z" }],
        });
        renderWithQuery(<AutoHealthChecks />);

        await advance(10 * 60_000 + 200);
        expect(providerCheckMock).toHaveBeenCalledTimes(1);
    });

    it("does not schedule any interval when the configured cadence is 0", async () => {
        prefsGetMock.mockReturnValue({
            data: { mcp_auto_check_interval_minutes: 0, provider_auto_check_interval_minutes: 0 },
        });
        mcpListMock.mockReturnValue({
            data: [{ id: "m1", enabled: true, last_check_at: "2024-01-01T00:00:00Z" }],
        });
        renderWithQuery(<AutoHealthChecks />);

        await advance(60 * 60_000);
        expect(mcpCheckMock).not.toHaveBeenCalled();
    });

    it("stops probing after unmount (interval cleared)", async () => {
        prefsGetMock.mockReturnValue({
            data: { mcp_auto_check_interval_minutes: 5, provider_auto_check_interval_minutes: 0 },
        });
        mcpListMock.mockReturnValue({
            data: [{ id: "m1", enabled: true, last_check_at: "2024-01-01T00:00:00Z" }],
        });
        const { unmount } = renderWithQuery(<AutoHealthChecks />);

        await advance(5 * 60_000 + 200);
        expect(mcpCheckMock).toHaveBeenCalledTimes(1);

        unmount();
        await advance(5 * 60_000 + 200);
        // No further calls after unmount — the interval was cleared.
        expect(mcpCheckMock).toHaveBeenCalledTimes(1);
    });
});
