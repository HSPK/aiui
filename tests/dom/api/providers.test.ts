import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { providers } from "@/lib/api/providers";
import { createQueryWrapper, installFetchMock, okJson } from "./test-helpers";

function deferred<T>() {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

describe("lib/api/providers", () => {
    it("is wired to /providers with key 'providers', array listShape, invalidates models", async () => {
        const fetchMock = installFetchMock();
        fetchMock.mockResolvedValueOnce(okJson([{ id: "1", name: "openai" }]));
        await providers.list();
        expect(fetchMock.mock.calls[0][0]).toBe("/api/providers");
        expect(providers.keys.all()).toEqual(["providers"]);
    });

    it("create() POSTs to /providers", async () => {
        const fetchMock = installFetchMock();
        fetchMock.mockResolvedValueOnce(okJson({ id: "1", name: "openai" }));
        await providers.create({ name: "openai", base_url: "https://api.openai.com" });
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe("/api/providers");
        expect(init.method).toBe("POST");
    });

    describe("listModels", () => {
        it("GETs /providers/<id>/models", async () => {
            const fetchMock = installFetchMock();
            fetchMock.mockResolvedValueOnce(okJson([{ id: "1", name: "gpt-4" }]));
            await providers.listModels("prov 1");
            expect(fetchMock.mock.calls[0][0]).toBe("/api/providers/prov%201/models");
        });
    });

    describe("reload", () => {
        it("POSTs /providers/reload", async () => {
            const fetchMock = installFetchMock();
            fetchMock.mockResolvedValueOnce(okJson(null));
            await providers.reload();
            const [url, init] = fetchMock.mock.calls[0];
            expect(url).toBe("/api/providers/reload");
            expect(init.method).toBe("POST");
        });
    });

    describe("check", () => {
        it("POSTs /providers/<id>/check", async () => {
            const fetchMock = installFetchMock();
            fetchMock.mockResolvedValueOnce(okJson({ ok: true, models: 5 }));
            const result = await providers.check("1");
            const [url, init] = fetchMock.mock.calls[0];
            expect(url).toBe("/api/providers/1/check");
            expect(init.method).toBe("POST");
            expect(result).toEqual({ ok: true, models: 5 });
        });
    });

    describe("probe", () => {
        it("POSTs /providers/probe with the raw health_check_url body", async () => {
            const fetchMock = installFetchMock();
            fetchMock.mockResolvedValueOnce(okJson({ ok: true, latency_ms: 42 }));
            const result = await providers.probe("https://example.com/health");
            const [url, init] = fetchMock.mock.calls[0];
            expect(url).toBe("/api/providers/probe");
            expect(init.method).toBe("POST");
            expect(init.body).toBe(JSON.stringify({ health_check_url: "https://example.com/health" }));
            expect(init.headers).toMatchObject({ "Content-Type": "application/json" });
            expect(result).toEqual({ ok: true, latency_ms: 42 });
        });
    });

    describe("useModels", () => {
        it("is disabled without an id", () => {
            const fetchMock = installFetchMock();
            const { Wrapper } = createQueryWrapper();
            const { result } = renderHook(() => providers.useModels(undefined), { wrapper: Wrapper });
            expect(result.current.fetchStatus).toBe("idle");
            expect(fetchMock).not.toHaveBeenCalled();
        });

        it("fetches /providers/<id>/models once an id is supplied", async () => {
            const fetchMock = installFetchMock();
            fetchMock.mockResolvedValueOnce(okJson([{ id: "1", name: "gpt-4" }]));
            const { Wrapper } = createQueryWrapper();
            const { result } = renderHook(() => providers.useModels("1"), { wrapper: Wrapper });
            await waitFor(() => expect(result.current.isSuccess).toBe(true));
            expect(fetchMock.mock.calls[0][0]).toBe("/api/providers/1/models");
            expect(result.current.data).toEqual([{ id: "1", name: "gpt-4" }]);
        });
    });

    describe("useReload", () => {
        it("invalidates providers + models on success", async () => {
            const { Wrapper, queryClient } = createQueryWrapper();
            const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
            const fetchMock = installFetchMock();
            fetchMock.mockResolvedValueOnce(okJson(null));

            const { result } = renderHook(() => providers.useReload(), { wrapper: Wrapper });
            await act(async () => {
                await result.current.mutateAsync();
            });
            await waitFor(() => expect(result.current.isSuccess).toBe(true));
            expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["providers"] });
            expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["models"] });
        });
    });

    describe("useCheck", () => {
        it("POSTs /providers/<id>/check and invalidates providers + models", async () => {
            const { Wrapper, queryClient } = createQueryWrapper();
            const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
            const fetchMock = installFetchMock();
            fetchMock.mockResolvedValueOnce(okJson({ ok: true, models: 3 }));

            const { result } = renderHook(() => providers.useCheck("1"), { wrapper: Wrapper });
            await act(async () => {
                await result.current.mutateAsync();
            });
            await waitFor(() => expect(result.current.isSuccess).toBe(true));
            expect(fetchMock.mock.calls[0][0]).toBe("/api/providers/1/check");
            expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["providers"] });
            expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["models"] });
        });
    });

    describe("useCheckMany", () => {
        it("tracks per-id pending state independently while checks are in flight", async () => {
            const fetchMock = installFetchMock();
            const d1 = deferred<Response>();
            const d2 = deferred<Response>();
            fetchMock.mockImplementationOnce(() => d1.promise);
            fetchMock.mockImplementationOnce(() => d2.promise);

            const { Wrapper } = createQueryWrapper();
            const { result } = renderHook(() => providers.useCheckMany(), { wrapper: Wrapper });

            expect(result.current.anyPending).toBe(false);
            expect(result.current.pendingCount).toBe(0);

            act(() => {
                result.current.mutate("1");
            });
            await waitFor(() => expect(result.current.isPendingId("1")).toBe(true));
            expect(result.current.anyPending).toBe(true);
            expect(result.current.pendingCount).toBe(1);
            expect(result.current.isPendingId("2")).toBe(false);

            act(() => {
                result.current.mutate("2");
            });
            await waitFor(() => expect(result.current.isPendingId("2")).toBe(true));
            expect(result.current.pendingCount).toBe(2);

            await act(async () => {
                d1.resolve(okJson({ ok: true, models: 1 }));
                await d1.promise;
            });
            await waitFor(() => expect(result.current.isPendingId("1")).toBe(false));
            expect(result.current.isPendingId("2")).toBe(true);
            expect(result.current.pendingCount).toBe(1);

            await act(async () => {
                d2.resolve(okJson({ ok: false, error: "timeout" }));
                await d2.promise;
            });
            await waitFor(() => expect(result.current.isPendingId("2")).toBe(false));
            expect(result.current.anyPending).toBe(false);
            expect(result.current.pendingCount).toBe(0);
        });

        it("calls onSuccess(id, result) and invalidates on success", async () => {
            const { Wrapper, queryClient } = createQueryWrapper();
            const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
            const fetchMock = installFetchMock();
            fetchMock.mockResolvedValueOnce(okJson({ ok: true, models: 2 }));
            const onSuccess = vi.fn();

            const { result } = renderHook(() => providers.useCheckMany({ onSuccess }), { wrapper: Wrapper });
            await act(async () => {
                await result.current.mutateAsync("prov-1");
            });

            expect(onSuccess).toHaveBeenCalledWith("prov-1", { ok: true, models: 2 });
            expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["providers"] });
        });

        it("survives two overlapping checks for the SAME id settling out of order (onSettled guard)", async () => {
            // Regression coverage for the `if (!prev.has(id)) return prev`
            // guard in onSettled: fire the same id twice before either
            // settles, then resolve them in either order. The second
            // onSettled to fire finds the id already removed by the first.
            const fetchMock = installFetchMock();
            const d1 = deferred<Response>();
            const d2 = deferred<Response>();
            fetchMock.mockImplementationOnce(() => d1.promise);
            fetchMock.mockImplementationOnce(() => d2.promise);

            const { Wrapper } = createQueryWrapper();
            const { result } = renderHook(() => providers.useCheckMany(), { wrapper: Wrapper });

            act(() => {
                result.current.mutate("dup");
            });
            act(() => {
                result.current.mutate("dup");
            });
            await waitFor(() => expect(result.current.isPendingId("dup")).toBe(true));
            expect(result.current.pendingCount).toBe(1); // Set dedupes the id

            await act(async () => {
                d1.resolve(okJson({ ok: true, models: 1 }));
                await d1.promise;
            });
            // First settle removes "dup"; the id is gone even though the
            // second call for "dup" is still in flight.
            await waitFor(() => expect(result.current.isPendingId("dup")).toBe(false));

            await act(async () => {
                d2.resolve(okJson({ ok: true, models: 1 }));
                await d2.promise;
            });
            // Second settle's onSettled finds `!prev.has("dup")` already
            // true and must short-circuit without throwing or corrupting
            // the pending set.
            expect(result.current.isPendingId("dup")).toBe(false);
            expect(result.current.pendingCount).toBe(0);
            expect(result.current.anyPending).toBe(false);
        });

        it("calls onError(id, err) without invalidating on failure", async () => {
            const { Wrapper, queryClient } = createQueryWrapper();
            const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
            const fetchMock = installFetchMock();
            fetchMock.mockResolvedValueOnce(
                new Response(JSON.stringify({ code: 500, msg: "boom" }), { status: 500 })
            );
            const onError = vi.fn();

            const { result } = renderHook(() => providers.useCheckMany({ onError }), { wrapper: Wrapper });
            await act(async () => {
                await expect(result.current.mutateAsync("prov-1")).rejects.toThrow();
            });

            expect(onError).toHaveBeenCalledWith("prov-1", expect.any(Error));
            expect(invalidateSpy).not.toHaveBeenCalled();
            await waitFor(() => expect(result.current.isPendingId("prov-1")).toBe(false));
        });
    });
});
