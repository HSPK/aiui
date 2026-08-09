import { describe, expect, it } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { stats } from "@/lib/api/stats";
import { createQueryWrapper, installFetchMock, okJson } from "./test-helpers";

describe("lib/api/stats", () => {
    describe("keys", () => {
        it("builds hierarchical query keys", () => {
            expect(stats.keys.all()).toEqual(["stats"]);
            expect(stats.keys.overview({ days: 14 })).toEqual(["stats", "overview", { days: 14 }]);
            expect(stats.keys.model("gpt-4", { days: 7 })).toEqual(["stats", "model", "gpt-4", { days: 7 }]);
        });
    });

    describe("getOverview", () => {
        it("GETs /stats with no query when called with no args", async () => {
            const fetchMock = installFetchMock();
            fetchMock.mockResolvedValueOnce(okJson({ window_start: "2024-01-01", window_end: "2024-01-14", days: 14 }));
            await stats.getOverview();
            expect(fetchMock.mock.calls[0][0]).toBe("/api/stats");
        });

        it("GETs /stats?days=7 when a query is supplied", async () => {
            const fetchMock = installFetchMock();
            fetchMock.mockResolvedValueOnce(okJson({ window_start: "2024-01-08", window_end: "2024-01-14", days: 7 }));
            await stats.getOverview({ days: 7 });
            expect(fetchMock.mock.calls[0][0]).toBe("/api/stats?days=7");
        });

        it("includes user_id in the query string when supplied", async () => {
            const fetchMock = installFetchMock();
            fetchMock.mockResolvedValueOnce(okJson({ window_start: "2024-01-01", window_end: "2024-01-14", days: 14 }));
            await stats.getOverview({ days: 14, user_id: "u1" });
            expect(fetchMock.mock.calls[0][0]).toBe("/api/stats?days=14&user_id=u1");
        });
    });

    describe("getModel", () => {
        it("GETs /stats/models/<name> with url-encoding", async () => {
            const fetchMock = installFetchMock();
            fetchMock.mockResolvedValueOnce(okJson({ model_name: "gpt 4", provider: "openai" }));
            await stats.getModel("gpt 4");
            expect(fetchMock.mock.calls[0][0]).toBe("/api/stats/models/gpt%204");
        });

        it("forwards the query string", async () => {
            const fetchMock = installFetchMock();
            fetchMock.mockResolvedValueOnce(okJson({ model_name: "gpt-4", provider: "openai" }));
            await stats.getModel("gpt-4", { days: 30 });
            expect(fetchMock.mock.calls[0][0]).toBe("/api/stats/models/gpt-4?days=30");
        });
    });

    describe("useOverview", () => {
        it("fetches on mount and uses the overview key", async () => {
            const fetchMock = installFetchMock();
            fetchMock.mockResolvedValueOnce(okJson({ window_start: "2024-01-01", window_end: "2024-01-14", days: 14 }));
            const { Wrapper } = createQueryWrapper();
            const { result } = renderHook(() => stats.useOverview({ days: 14 }), { wrapper: Wrapper });
            await waitFor(() => expect(result.current.isSuccess).toBe(true));
            expect(result.current.data).toEqual({ window_start: "2024-01-01", window_end: "2024-01-14", days: 14 });
            expect(fetchMock.mock.calls[0][0]).toBe("/api/stats?days=14");
        });
    });

    describe("useModel", () => {
        it("is disabled when name is null/undefined", () => {
            const fetchMock = installFetchMock();
            const { Wrapper } = createQueryWrapper();
            const { result } = renderHook(() => stats.useModel(null), { wrapper: Wrapper });
            expect(result.current.fetchStatus).toBe("idle");
            expect(fetchMock).not.toHaveBeenCalled();
        });

        it("fetches when a name is supplied", async () => {
            const fetchMock = installFetchMock();
            fetchMock.mockResolvedValueOnce(okJson({ model_name: "gpt-4", provider: "openai" }));
            const { Wrapper } = createQueryWrapper();
            const { result } = renderHook(() => stats.useModel("gpt-4"), { wrapper: Wrapper });
            await waitFor(() => expect(result.current.isSuccess).toBe(true));
            expect(fetchMock.mock.calls[0][0]).toBe("/api/stats/models/gpt-4");
        });
    });
});
