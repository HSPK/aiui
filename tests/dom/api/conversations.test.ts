import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { conversations, messages, messagesCacheKey } from "@/lib/api/conversations";
import { createQueryWrapper, installFetchMock, okJson } from "./test-helpers";

describe("lib/api/conversations", () => {
    it("is wired to /conversations with key 'conversations' (paginated)", async () => {
        const fetchMock = installFetchMock();
        fetchMock.mockResolvedValueOnce(okJson({ items: [], total: 0, page: 1, page_size: 20 }));
        await conversations.list();
        expect(fetchMock.mock.calls[0][0]).toBe(
            "/api/conversations?page=1&page_size=20&sort=-updated_at"
        );
        expect(conversations.keys.all()).toEqual(["conversations"]);
    });

    it("list(query) applies paramsOf defaults and drops an absent keyword", async () => {
        const fetchMock = installFetchMock();
        fetchMock.mockResolvedValueOnce(okJson({ items: [], total: 0, page: 2, page_size: 10 }));
        await conversations.list({ page: 2, page_size: 10, keyword: "hi" });
        expect(fetchMock.mock.calls[0][0]).toBe(
            "/api/conversations?page=2&page_size=10&sort=-updated_at&keyword=hi"
        );
    });

    it("get() GETs /conversations/<id>", async () => {
        const fetchMock = installFetchMock();
        fetchMock.mockResolvedValueOnce(okJson({ id: "1", title: "hi" }));
        await conversations.get("1");
        expect(fetchMock.mock.calls[0][0]).toBe("/api/conversations/1");
    });

    it("remove() DELETEs /conversations/<id>", async () => {
        const fetchMock = installFetchMock();
        fetchMock.mockResolvedValueOnce(okJson(null));
        await conversations.remove("1");
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe("/api/conversations/1");
        expect(init.method).toBe("DELETE");
    });

    describe("updateTitle", () => {
        it("PATCHes {title} only when expectedTitle is omitted", async () => {
            const fetchMock = installFetchMock();
            fetchMock.mockResolvedValueOnce(okJson({ id: "1", title: "New" }));
            await conversations.updateTitle("1", "New");
            const [url, init] = fetchMock.mock.calls[0];
            expect(url).toBe("/api/conversations/1");
            expect(init.method).toBe("PATCH");
            expect(init.body).toBe(JSON.stringify({ title: "New" }));
        });

        it("PATCHes {title, expected_title} for the compare-and-swap path", async () => {
            const fetchMock = installFetchMock();
            fetchMock.mockResolvedValueOnce(okJson({ id: "1", title: "New" }));
            await conversations.updateTitle("1", "New", "Old");
            const [, init] = fetchMock.mock.calls[0];
            expect(init.body).toBe(JSON.stringify({ title: "New", expected_title: "Old" }));
        });
    });

    describe("messagesCacheKey", () => {
        it("nests under the conversation's one() key with a page-size-scoped suffix", () => {
            expect(messagesCacheKey("1", 50)).toEqual(["conversations", "1", "messages-cache", 50]);
        });
    });

    describe("listMessages", () => {
        it("GETs /conversations/<id>/messages with default pagination", async () => {
            const fetchMock = installFetchMock();
            fetchMock.mockResolvedValueOnce(okJson({ items: [], total: 0, page: 1, page_size: 50 }));
            await conversations.listMessages("1");
            expect(fetchMock.mock.calls[0][0]).toBe(
                "/api/conversations/1/messages?page=1&page_size=50&sort=-created_at"
            );
        });

        it("GETs /conversations/<id>/messages with overridden pagination/sort", async () => {
            const fetchMock = installFetchMock();
            fetchMock.mockResolvedValueOnce(okJson({ items: [], total: 0, page: 2, page_size: 10 }));
            await conversations.listMessages("1", { page: 2, page_size: 10, sort: "created_at" });
            expect(fetchMock.mock.calls[0][0]).toBe(
                "/api/conversations/1/messages?page=2&page_size=10&sort=created_at"
            );
        });

        it("url-encodes the conversation id", async () => {
            const fetchMock = installFetchMock();
            fetchMock.mockResolvedValueOnce(okJson({ items: [], total: 0, page: 1, page_size: 50 }));
            await conversations.listMessages("conv 1");
            expect(fetchMock.mock.calls[0][0]).toBe(
                "/api/conversations/conv%201/messages?page=1&page_size=50&sort=-created_at"
            );
        });
    });

    describe("useInfinite", () => {
        it("fetches the first page with default pageSize 20 and scope 'default'", async () => {
            const fetchMock = installFetchMock();
            fetchMock.mockResolvedValueOnce(okJson({ items: [{ id: "1" }], total: 1, page: 1, page_size: 20 }));
            const { Wrapper } = createQueryWrapper();
            const { result } = renderHook(() => conversations.useInfinite(), { wrapper: Wrapper });
            await waitFor(() => expect(result.current.isSuccess).toBe(true));
            expect(fetchMock.mock.calls[0][0]).toBe("/api/conversations?page=1&page_size=20&sort=-updated_at");
            expect(result.current.data?.pages).toEqual([{ items: [{ id: "1" }], total: 1, page: 1, page_size: 20 }]);
        });

        it("trims a blank keyword down to undefined (dropped from the query)", async () => {
            const fetchMock = installFetchMock();
            fetchMock.mockResolvedValueOnce(okJson({ items: [], total: 0, page: 1, page_size: 20 }));
            const { Wrapper } = createQueryWrapper();
            const { result } = renderHook(() => conversations.useInfinite({ keyword: "   " }), { wrapper: Wrapper });
            await waitFor(() => expect(result.current.isSuccess).toBe(true));
            expect(fetchMock.mock.calls[0][0]).toBe("/api/conversations?page=1&page_size=20&sort=-updated_at");
        });

        it("exposes fetchNextPage / getNextPageParam when more pages remain", async () => {
            const fetchMock = installFetchMock();
            fetchMock.mockResolvedValueOnce(okJson({ items: [{ id: "1" }], total: 3, page: 1, page_size: 1 }));
            const { Wrapper } = createQueryWrapper();
            const { result } = renderHook(() => conversations.useInfinite({ pageSize: 1 }), { wrapper: Wrapper });
            await waitFor(() => expect(result.current.isSuccess).toBe(true));
            expect(result.current.hasNextPage).toBe(true);

            fetchMock.mockResolvedValueOnce(okJson({ items: [{ id: "2" }], total: 3, page: 2, page_size: 1 }));
            // fetchNextPage()'s own resolved value already carries the fresh
            // 2-page result — assert on that directly rather than
            // result.current, which lags behind an extra notifyManager tick
            // that a real-timer waitFor() can't deterministically observe.
            let nextResult!: Awaited<ReturnType<typeof result.current.fetchNextPage>>;
            await act(async () => {
                nextResult = await result.current.fetchNextPage();
            });
            expect(fetchMock.mock.calls[1][0]).toBe("/api/conversations?page=2&page_size=1&sort=-updated_at");
            expect(nextResult.data?.pages).toHaveLength(2);
            expect(nextResult.data?.pages[1]).toEqual({ items: [{ id: "2" }], total: 3, page: 2, page_size: 1 });
        });

        it("reports hasNextPage=false once every item has been paged through", async () => {
            const fetchMock = installFetchMock();
            fetchMock.mockResolvedValueOnce(okJson({ items: [{ id: "1" }, { id: "2" }], total: 2, page: 1, page_size: 20 }));
            const { Wrapper } = createQueryWrapper();
            const { result } = renderHook(() => conversations.useInfinite(), { wrapper: Wrapper });
            await waitFor(() => expect(result.current.isSuccess).toBe(true));
            expect(result.current.hasNextPage).toBe(false);
        });

        it("treats an empty/undefined page as exhausted (getNextPageParam's falsy-lastPage guard)", async () => {
            const fetchMock = installFetchMock();
            fetchMock.mockResolvedValueOnce(okJson(null));
            const { Wrapper } = createQueryWrapper();
            const { result } = renderHook(() => conversations.useInfinite(), { wrapper: Wrapper });
            await waitFor(() => expect(result.current.isSuccess).toBe(true));
            expect(result.current.hasNextPage).toBe(false);
        });
    });

    describe("useInvalidateList", () => {
        it("invalidates list/infinite query shapes but leaves one()/messages-cache intact", () => {
            const { Wrapper, queryClient } = createQueryWrapper();
            const listKey = conversations.keys.list();
            const infiniteKey = [...conversations.keys.all(), "infinite", "default", 20, ""] as const;
            const oneKey = conversations.keys.one("1");
            const msgKey = messagesCacheKey("1", 20);

            queryClient.setQueryData(listKey as unknown as unknown[], { items: [], total: 0, page: 1, page_size: 20 });
            queryClient.setQueryData(infiniteKey as unknown as unknown[], { pages: [], pageParams: [] });
            queryClient.setQueryData(oneKey as unknown as unknown[], { id: "1", title: "hi" });
            queryClient.setQueryData(msgKey as unknown as unknown[], { items: [], total: 0, page: 1, page_size: 20 });

            const { result } = renderHook(() => conversations.useInvalidateList(), { wrapper: Wrapper });
            act(() => {
                result.current();
            });

            const isInvalidated = (key: readonly unknown[]) =>
                queryClient.getQueryCache().find({ queryKey: key as unknown[] })?.state.isInvalidated;

            expect(isInvalidated(listKey)).toBe(true);
            expect(isInvalidated(infiniteKey)).toBe(true);
            expect(isInvalidated(oneKey)).toBeFalsy();
            expect(isInvalidated(msgKey)).toBeFalsy();
        });
    });
});

describe("lib/api/messages", () => {
    it("keys.all() is a stable ['messages'] tuple", () => {
        expect(messages.keys.all()).toEqual(["messages"]);
    });

    it("rate() POSTs {rating, feedback} to /messages/<id>/rate", async () => {
        const fetchMock = installFetchMock();
        fetchMock.mockResolvedValueOnce(okJson(null));
        await messages.rate("m1", "up", "great answer");
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe("/api/messages/m1/rate");
        expect(init.method).toBe("POST");
        expect(init.body).toBe(JSON.stringify({ rating: "up", feedback: "great answer" }));
    });

    it("rate() omits feedback from the JSON body when not supplied", async () => {
        const fetchMock = installFetchMock();
        fetchMock.mockResolvedValueOnce(okJson(null));
        await messages.rate("m1", "none");
        const [, init] = fetchMock.mock.calls[0];
        expect(init.body).toBe(JSON.stringify({ rating: "none" }));
    });

    it("url-encodes the message id", async () => {
        const fetchMock = installFetchMock();
        fetchMock.mockResolvedValueOnce(okJson(null));
        await messages.rate("m 1", "down");
        expect(fetchMock.mock.calls[0][0]).toBe("/api/messages/m%201/rate");
    });
});
