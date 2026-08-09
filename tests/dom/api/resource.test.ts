import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineResource } from "@/lib/api/resource";
import type { Paginated } from "@/lib/schemas/common";
import { createQueryWrapper, installFetchMock, okJson } from "./test-helpers";

interface Item {
    id: string;
    name: string;
}
type ItemCreate = { name: string };
type ItemUpdate = Partial<ItemCreate>;
type ItemQuery = { page?: number; keyword?: string };

/** A promise you can resolve/reject from outside, for controlling exactly
 *  when a mocked fetch call settles (needed to observe in-flight states
 *  like placeholderData / isFetching). */
function deferred<T>() {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

describe("lib/api/resource (defineResource)", () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchMock = installFetchMock();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    // ---- plain resources reused across sections ----
    const arrayResource = defineResource<Item, ItemCreate, ItemUpdate, ItemQuery, Item[]>({
        path: "/items",
        key: "items",
        listShape: "array",
    });
    const paginatedResource = defineResource<Item, ItemCreate, ItemUpdate, ItemQuery, Paginated<Item>>({
        path: "/pitems",
        key: "pitems",
        // listShape omitted -> default "paginated" per the docstring.
    });

    describe("raw fetch functions", () => {
        it("list() hits GET <path> with no query string when the query is empty", async () => {
            fetchMock.mockResolvedValueOnce(okJson([]));
            await arrayResource.list();
            const [url, init] = fetchMock.mock.calls[0];
            expect(url).toBe("/api/items");
            expect(init.method).toBeUndefined();
        });

        it("list(query) passes filters through as URL params by default (identity paramsOf)", async () => {
            fetchMock.mockResolvedValueOnce(okJson([]));
            await arrayResource.list({ page: 2, keyword: "abc" });
            const [url] = fetchMock.mock.calls[0];
            expect(url).toBe("/api/items?page=2&keyword=abc");
        });

        it("list() returns whatever shape the server sent — array", async () => {
            const items = [{ id: "1", name: "one" }];
            fetchMock.mockResolvedValueOnce(okJson(items));
            await expect(arrayResource.list()).resolves.toEqual(items);
        });

        it("list() returns whatever shape the server sent — paginated", async () => {
            const page: Paginated<Item> = { items: [{ id: "1", name: "one" }], total: 1, page: 1, page_size: 20 };
            fetchMock.mockResolvedValueOnce(okJson(page));
            await expect(paginatedResource.list()).resolves.toEqual(page);
        });

        it("get(id) hits GET <path>/<encodeURIComponent(id)> by default", async () => {
            fetchMock.mockResolvedValueOnce(okJson({ id: "a b/c", name: "x" }));
            await arrayResource.get("a b/c");
            const [url] = fetchMock.mock.calls[0];
            expect(url).toBe("/api/items/a%20b%2Fc");
        });

        it("get(id) uses a custom encode() when supplied", async () => {
            const custom = defineResource<Item, ItemCreate, ItemUpdate>({
                path: "/citems",
                key: "citems",
                encode: (id) => `enc-${id}`,
            });
            fetchMock.mockResolvedValueOnce(okJson({ id: "x", name: "x" }));
            await custom.get("raw-id");
            const [url] = fetchMock.mock.calls[0];
            expect(url).toBe("/api/citems/enc-raw-id");
        });

        it("create(data) POSTs JSON to <path>", async () => {
            fetchMock.mockResolvedValueOnce(okJson({ id: "1", name: "new" }));
            await arrayResource.create({ name: "new" });
            const [url, init] = fetchMock.mock.calls[0];
            expect(url).toBe("/api/items");
            expect(init.method).toBe("POST");
            expect(init.body).toBe(JSON.stringify({ name: "new" }));
        });

        it("update(id, data) PATCHes JSON to <path>/<id>", async () => {
            fetchMock.mockResolvedValueOnce(okJson({ id: "1", name: "renamed" }));
            await arrayResource.update("1", { name: "renamed" });
            const [url, init] = fetchMock.mock.calls[0];
            expect(url).toBe("/api/items/1");
            expect(init.method).toBe("PATCH");
            expect(init.body).toBe(JSON.stringify({ name: "renamed" }));
        });

        it("remove(id) DELETEs <path>/<id>", async () => {
            fetchMock.mockResolvedValueOnce(okJson(null));
            await arrayResource.remove("1");
            const [url, init] = fetchMock.mock.calls[0];
            expect(url).toBe("/api/items/1");
            expect(init.method).toBe("DELETE");
        });
    });

    describe("query keys", () => {
        it("keys.all() is [key]", () => {
            expect(arrayResource.keys.all()).toEqual(["items"]);
        });

        it("keys.list(query) is [key, 'list', projected query]", () => {
            expect(arrayResource.keys.list({ page: 2 })).toEqual(["items", "list", { page: 2 }]);
        });

        it("keys.list() with no arg projects an empty object", () => {
            expect(arrayResource.keys.list()).toEqual(["items", "list", {}]);
        });

        it("keys.one(id) is [key, id]", () => {
            expect(arrayResource.keys.one("42")).toEqual(["items", "42"]);
        });
    });

    describe("paramsOf projection", () => {
        const projected = defineResource<Item, ItemCreate, ItemUpdate, ItemQuery>({
            path: "/qitems",
            key: "qitems",
            paramsOf: (q) => ({ p: q.page ?? 1, kw: q.keyword }),
        });

        it("projects query params for the raw list() fetch", async () => {
            fetchMock.mockResolvedValueOnce(okJson([]));
            await projected.list({ keyword: "hi" });
            const [url] = fetchMock.mock.calls[0];
            expect(url).toBe("/api/qitems?p=1&kw=hi");
        });

        it("projects query params for keys.list() too, so the cache key matches the fetch", () => {
            expect(projected.keys.list({ page: 3 })).toEqual(["qitems", "list", { p: 3, kw: undefined }]);
        });
    });

    describe("useList", () => {
        it("fetches on mount and exposes the result", async () => {
            fetchMock.mockResolvedValueOnce(okJson([{ id: "1", name: "one" }]));
            const { Wrapper } = createQueryWrapper();
            const { result } = renderHook(() => arrayResource.useList(), { wrapper: Wrapper });
            await waitFor(() => expect(result.current.isSuccess).toBe(true));
            expect(result.current.data).toEqual([{ id: "1", name: "one" }]);
            expect(fetchMock).toHaveBeenCalledTimes(1);
        });

        it("keeps previous data as placeholderData while a new query key is in flight (default keepPrev)", async () => {
            const { Wrapper } = createQueryWrapper();
            const d1 = deferred<Response>();
            const d2 = deferred<Response>();
            fetchMock.mockImplementationOnce(() => d1.promise).mockImplementationOnce(() => d2.promise);

            const { result, rerender } = renderHook(
                ({ q }: { q: ItemQuery }) => arrayResource.useList(q),
                { wrapper: Wrapper, initialProps: { q: { page: 1 } } },
            );

            d1.resolve(okJson([{ id: "1", name: "one" }]));
            await waitFor(() => expect(result.current.data).toEqual([{ id: "1", name: "one" }]));

            rerender({ q: { page: 2 } });
            // New queryKey -> fetching, but old data is still shown via placeholderData.
            expect(result.current.data).toEqual([{ id: "1", name: "one" }]);
            expect(result.current.isPlaceholderData).toBe(true);

            d2.resolve(okJson([{ id: "2", name: "two" }]));
            await waitFor(() => expect(result.current.data).toEqual([{ id: "2", name: "two" }]));
            expect(result.current.isPlaceholderData).toBe(false);
        });

        it("does NOT keep previous data when keepPrev: false", async () => {
            const noKeepPrev = defineResource<Item, ItemCreate, ItemUpdate, ItemQuery>({
                path: "/nkitems",
                key: "nkitems",
                keepPrev: false,
            });
            const { Wrapper } = createQueryWrapper();
            const d1 = deferred<Response>();
            const d2 = deferred<Response>();
            fetchMock.mockImplementationOnce(() => d1.promise).mockImplementationOnce(() => d2.promise);

            const { result, rerender } = renderHook(
                ({ q }: { q: ItemQuery }) => noKeepPrev.useList(q),
                { wrapper: Wrapper, initialProps: { q: { page: 1 } } },
            );
            d1.resolve(okJson([{ id: "1", name: "one" }]));
            await waitFor(() => expect(result.current.data).toEqual([{ id: "1", name: "one" }]));

            rerender({ q: { page: 2 } });
            // No placeholderData configured -> data goes back to undefined while refetching.
            expect(result.current.data).toBeUndefined();

            d2.resolve(okJson([{ id: "2", name: "two" }]));
            await waitFor(() => expect(result.current.data).toEqual([{ id: "2", name: "two" }]));
        });

        it("passes staleTime through so a remount with the same key skips refetching", async () => {
            const stale = defineResource<Item, ItemCreate, ItemUpdate>({
                path: "/sitems",
                key: "sitems",
                staleTime: 60_000,
            });
            const { Wrapper } = createQueryWrapper();
            fetchMock.mockResolvedValue(okJson([{ id: "1", name: "one" }]));

            const { result, unmount } = renderHook(() => stale.useList(), { wrapper: Wrapper });
            await waitFor(() => expect(result.current.isSuccess).toBe(true));
            expect(fetchMock).toHaveBeenCalledTimes(1);
            unmount();

            const { result: result2 } = renderHook(() => stale.useList(), { wrapper: Wrapper });
            await waitFor(() => expect(result2.current.isSuccess).toBe(true));
            // Still fresh -> served from cache, no second network call.
            expect(fetchMock).toHaveBeenCalledTimes(1);
        });

        it("without staleTime, a remount with the same key refetches (data is immediately stale)", async () => {
            const { Wrapper } = createQueryWrapper();
            fetchMock.mockResolvedValue(okJson([{ id: "1", name: "one" }]));

            const { result, unmount } = renderHook(() => arrayResource.useList(), { wrapper: Wrapper });
            await waitFor(() => expect(result.current.isSuccess).toBe(true));
            expect(fetchMock).toHaveBeenCalledTimes(1);
            unmount();

            const { result: result2 } = renderHook(() => arrayResource.useList(), { wrapper: Wrapper });
            await waitFor(() => expect(result2.current.isSuccess).toBe(true));
            expect(fetchMock).toHaveBeenCalledTimes(2);
        });

        it("forwards caller-supplied query options (e.g. a custom select)", async () => {
            // Note: `useList`'s `opts` type is `Omit<UseQueryOptions<TListResult>, ...>`
            // with a single type argument, so TanStack's `select` is pinned to a
            // same-shape transform (TListResult -> TListResult) rather than an
            // arbitrary TListResult -> TSelected narrowing. This is a real static
            // typing limitation (no current production caller hits it), so this
            // test demonstrates select-forwarding with a same-shape transform.
            fetchMock.mockResolvedValueOnce(
                okJson([{ id: "1", name: "one" }, { id: "2", name: "two" }]),
            );
            const { Wrapper } = createQueryWrapper();
            const { result } = renderHook(
                () => arrayResource.useList({}, { select: (data) => [...data].reverse() }),
                { wrapper: Wrapper },
            );
            await waitFor(() => expect(result.current.isSuccess).toBe(true));
            expect(result.current.data).toEqual([{ id: "2", name: "two" }, { id: "1", name: "one" }]);
        });
    });

    describe("useGet", () => {
        it("is disabled (does not fetch) without an id", () => {
            const { Wrapper } = createQueryWrapper();
            const { result } = renderHook(() => arrayResource.useGet(undefined), { wrapper: Wrapper });
            expect(result.current.fetchStatus).toBe("idle");
            expect(result.current.data).toBeUndefined();
            expect(fetchMock).not.toHaveBeenCalled();
        });

        it("is disabled for null and empty-string ids too", () => {
            const { Wrapper } = createQueryWrapper();
            const { result: r1 } = renderHook(() => arrayResource.useGet(null), { wrapper: Wrapper });
            const { result: r2 } = renderHook(() => arrayResource.useGet(""), { wrapper: Wrapper });
            expect(r1.current.fetchStatus).toBe("idle");
            expect(r2.current.fetchStatus).toBe("idle");
            expect(fetchMock).not.toHaveBeenCalled();
        });

        it("fetches GET <path>/<id> once an id is supplied", async () => {
            fetchMock.mockResolvedValueOnce(okJson({ id: "1", name: "one" }));
            const { Wrapper } = createQueryWrapper();
            const { result } = renderHook(() => arrayResource.useGet("1"), { wrapper: Wrapper });
            await waitFor(() => expect(result.current.isSuccess).toBe(true));
            expect(result.current.data).toEqual({ id: "1", name: "one" });
            const [url] = fetchMock.mock.calls[0];
            expect(url).toBe("/api/items/1");
        });

        it("passes staleTime through so a remount with the same id skips refetching", async () => {
            const stale = defineResource<Item, ItemCreate, ItemUpdate>({
                path: "/sitems2",
                key: "sitems2",
                staleTime: 60_000,
            });
            const { Wrapper } = createQueryWrapper();
            fetchMock.mockResolvedValue(okJson({ id: "1", name: "one" }));

            const { result, unmount } = renderHook(() => stale.useGet("1"), { wrapper: Wrapper });
            await waitFor(() => expect(result.current.isSuccess).toBe(true));
            expect(fetchMock).toHaveBeenCalledTimes(1);
            unmount();

            const { result: result2 } = renderHook(() => stale.useGet("1"), { wrapper: Wrapper });
            await waitFor(() => expect(result2.current.isSuccess).toBe(true));
            expect(fetchMock).toHaveBeenCalledTimes(1);
        });
    });

    describe("useCreate", () => {
        it("POSTs and invalidates the resource's own list cache on success", async () => {
            const { Wrapper, queryClient } = createQueryWrapper();
            const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
            fetchMock.mockResolvedValueOnce(okJson({ id: "1", name: "new" }));

            const { result } = renderHook(() => arrayResource.useCreate(), { wrapper: Wrapper });
            await act(async () => {
                await result.current.mutateAsync({ name: "new" });
            });

            // The MutationObserver's `result.current` snapshot updates via
            // notifyManager's own microtask scheduling, which can lag one
            // tick behind the `mutateAsync` promise settling — poll instead
            // of asserting immediately.
            await waitFor(() => expect(result.current.isSuccess).toBe(true));
            expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["items"] });
        });

        it("also invalidates configured extra keys (e.g. models -> providers)", async () => {
            const withExtra = defineResource<Item, ItemCreate, ItemUpdate>({
                path: "/iitems",
                key: "iitems",
                invalidates: ["other-a", "other-b"],
            });
            const { Wrapper, queryClient } = createQueryWrapper();
            const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
            fetchMock.mockResolvedValueOnce(okJson({ id: "1", name: "new" }));

            const { result } = renderHook(() => withExtra.useCreate(), { wrapper: Wrapper });
            await act(async () => {
                await result.current.mutateAsync({ name: "new" });
            });

            expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["iitems"] });
            expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["other-a"] });
            expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["other-b"] });
        });

        it("calls the caller's onSuccess after invalidating", async () => {
            const { Wrapper } = createQueryWrapper();
            fetchMock.mockResolvedValueOnce(okJson({ id: "1", name: "new" }));
            const onSuccess = vi.fn();

            const { result } = renderHook(() => arrayResource.useCreate({ onSuccess }), { wrapper: Wrapper });
            await act(async () => {
                await result.current.mutateAsync({ name: "new" });
            });

            expect(onSuccess).toHaveBeenCalledTimes(1);
            expect(onSuccess.mock.calls[0][0]).toEqual({ id: "1", name: "new" });
        });

        it("surfaces failures via isError / onError without invalidating", async () => {
            const { Wrapper, queryClient } = createQueryWrapper();
            const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
            fetchMock.mockResolvedValueOnce(
                new Response(JSON.stringify({ code: 1, msg: "nope" }), {
                    status: 400,
                    headers: { "Content-Type": "application/json" },
                }),
            );
            const onError = vi.fn();

            const { result } = renderHook(() => arrayResource.useCreate({ onError }), { wrapper: Wrapper });
            act(() => {
                result.current.mutate({ name: "boom" });
            });
            await waitFor(() => expect(result.current.isError).toBe(true));

            expect(onError).toHaveBeenCalledTimes(1);
            expect(invalidateSpy).not.toHaveBeenCalled();
        });
    });

    describe("useUpdate", () => {
        it("PATCHes {id,data} and invalidates on success", async () => {
            const { Wrapper, queryClient } = createQueryWrapper();
            const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
            fetchMock.mockResolvedValueOnce(okJson({ id: "1", name: "renamed" }));

            const { result } = renderHook(() => arrayResource.useUpdate(), { wrapper: Wrapper });
            await act(async () => {
                await result.current.mutateAsync({ id: "1", data: { name: "renamed" } });
            });

            const [url, init] = fetchMock.mock.calls[0];
            expect(url).toBe("/api/items/1");
            expect(init.method).toBe("PATCH");
            expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["items"] });
            await waitFor(() => expect(result.current.data).toEqual({ id: "1", name: "renamed" }));
        });

        it("calls the caller's onSuccess after invalidating", async () => {
            const { Wrapper } = createQueryWrapper();
            fetchMock.mockResolvedValueOnce(okJson({ id: "1", name: "renamed" }));
            const onSuccess = vi.fn();
            const { result } = renderHook(() => arrayResource.useUpdate({ onSuccess }), { wrapper: Wrapper });
            await act(async () => {
                await result.current.mutateAsync({ id: "1", data: { name: "renamed" } });
            });
            expect(onSuccess).toHaveBeenCalledTimes(1);
        });
    });

    describe("useDelete", () => {
        it("DELETEs by id and invalidates on success", async () => {
            const { Wrapper, queryClient } = createQueryWrapper();
            const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
            fetchMock.mockResolvedValueOnce(okJson(null));

            const { result } = renderHook(() => arrayResource.useDelete(), { wrapper: Wrapper });
            await act(async () => {
                await result.current.mutateAsync("1");
            });

            const [url, init] = fetchMock.mock.calls[0];
            expect(url).toBe("/api/items/1");
            expect(init.method).toBe("DELETE");
            expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["items"] });
        });

        it("calls the caller's onSuccess after invalidating", async () => {
            const { Wrapper } = createQueryWrapper();
            fetchMock.mockResolvedValueOnce(okJson(null));
            const onSuccess = vi.fn();
            const { result } = renderHook(() => arrayResource.useDelete({ onSuccess }), { wrapper: Wrapper });
            await act(async () => {
                await result.current.mutateAsync("1");
            });
            expect(onSuccess).toHaveBeenCalledTimes(1);
        });
    });

    describe("useInvalidate", () => {
        it("invalidates the resource's own key plus configured extras when called", () => {
            const withExtra = defineResource<Item, ItemCreate, ItemUpdate>({
                path: "/iitems2",
                key: "iitems2",
                invalidates: ["extra-x"],
            });
            const { Wrapper, queryClient } = createQueryWrapper();
            const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
            const { result } = renderHook(() => withExtra.useInvalidate(), { wrapper: Wrapper });

            act(() => {
                result.current();
            });

            expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["iitems2"] });
            expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["extra-x"] });
        });
    });
});
