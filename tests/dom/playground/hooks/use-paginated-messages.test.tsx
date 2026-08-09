import * as React from "react"
import { act, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { createQueryWrapper, flushAsync } from "../_render"

const listMessagesMock = vi.hoisted(() => vi.fn())
const messagesCacheKeyMock = vi.hoisted(() =>
    vi.fn((conversationId: string, pageSize: number) => ["conversations", conversationId, "messages-cache", pageSize] as const)
)
vi.mock("@/lib/api/conversations", () => ({
    conversations: {
        listMessages: listMessagesMock,
        messagesCacheKey: messagesCacheKeyMock,
    },
}))

 
import {
    usePaginatedMessages,
    transformMessage,
    readCachedMessages,
} from "@/components/playground/hooks/use-paginated-messages"
 
import { ApiError } from "@/lib/api/client"
 
import type { Message } from "@/components/playground/chat/types"
 
import type { MessageDTO } from "@/lib/schemas/conversation"
 
import type { Paginated } from "@/lib/schemas/common"

function messageDTO(id: string, overrides: Partial<MessageDTO> = {}): MessageDTO {
    return {
        id,
        conversation_id: "conv_1",
        role: "assistant",
        content: `content-${id}`,
        is_active: true,
        created_at: "2024-01-01T00:00:00Z",
        ...overrides,
    }
}

function page(items: MessageDTO[], overrides: Partial<Paginated<MessageDTO>> = {}): Paginated<MessageDTO> {
    return { items, total: items.length, page: 1, page_size: 20, ...overrides }
}

function seedMessage(id: string): Message {
    return { id, role: "assistant", content: `seed-${id}` }
}

function deferred<T>() {
    let resolve!: (v: T) => void
    let reject!: (e: unknown) => void
    const promise = new Promise<T>((res, rej) => {
        resolve = res
        reject = rej
    })
    return { promise, resolve, reject }
}

afterEach(() => {
    listMessagesMock.mockReset()
})

// =============================================================================
// Pure helpers
// =============================================================================
describe("transformMessage", () => {
    it("passes a string content through unchanged", () => {
        const dto = messageDTO("m1", { content: "Hello world" })
        expect(transformMessage(dto).content).toBe("Hello world")
    })

    it("passes an array (multimodal) content through unchanged", () => {
        const parts = [{ type: "text", text: "Hi" }]
        const dto = messageDTO("m1", { content: parts })
        expect(transformMessage(dto).content).toBe(parts)
    })

    it("converts null content to an empty string", () => {
        const dto = messageDTO("m1", { content: null })
        expect(transformMessage(dto).content).toBe("")
    })

    it("converts undefined content to an empty string", () => {
        const dto = messageDTO("m1", { content: undefined })
        expect(transformMessage(dto).content).toBe("")
    })

    it("JSON-stringifies a non-array, non-string, non-null content (defensive fallback)", () => {
        const dto = messageDTO("m1", { content: { weird: "shape" } })
        expect(transformMessage(dto).content).toBe(JSON.stringify({ weird: "shape" }))
    })

    it("maps every FE-relevant field and drops server-only fields", () => {
        const dto = messageDTO("m1", {
            role: "assistant",
            content: "hi",
            reasoning_content: "because",
            model_id: "gpt-4o",
            generation_id: "gen_1",
            parent_id: "parent_1",
            rating: "up",
            feedback: "great",
            error: "boom",
        })
        const result = transformMessage(dto)
        expect(result).toEqual({
            id: "m1",
            role: "assistant",
            content: "hi",
            model_id: "gpt-4o",
            reasoning_content: "because",
            created_at: "2024-01-01T00:00:00Z",
            rating: "up",
            generation_id: "gen_1",
            feedback: "great",
            parent_id: "parent_1",
            error: "boom",
        })
        expect(result).not.toHaveProperty("conversation_id")
        expect(result).not.toHaveProperty("is_active")
    })
})

describe("readCachedMessages", () => {
    it("returns null when conversationId is undefined", () => {
        const { queryClient } = createQueryWrapper()
        expect(readCachedMessages(queryClient, undefined)).toBeNull()
    })

    it("returns null when nothing is cached for the conversation", () => {
        const { queryClient } = createQueryWrapper()
        expect(readCachedMessages(queryClient, "conv_1")).toBeNull()
    })

    it("returns the cached Message[] using the default pageSize of 20", () => {
        const { queryClient } = createQueryWrapper()
        const cached = [seedMessage("a"), seedMessage("b")]
        queryClient.setQueryData(messagesCacheKeyMock("conv_1", 20), cached)

        expect(readCachedMessages(queryClient, "conv_1")).toEqual(cached)
    })

    it("respects a custom pageSize when looking up the cache key", () => {
        const { queryClient } = createQueryWrapper()
        const cached = [seedMessage("a")]
        queryClient.setQueryData(messagesCacheKeyMock("conv_1", 5), cached)

        expect(readCachedMessages(queryClient, "conv_1", 5)).toEqual(cached)
        // A different pageSize is a different cache key -> miss.
        expect(readCachedMessages(queryClient, "conv_1", 20)).toBeNull()
    })
})

// =============================================================================
// usePaginatedMessages
// =============================================================================
function useHarness(props: { conversationId?: string; initialMessages: Message[]; pageSize?: number }) {
    const [messages, setMessages] = React.useState<Message[]>(props.initialMessages)
    const pagination = usePaginatedMessages({
        conversationId: props.conversationId,
        initialMessages: props.initialMessages,
        setMessages,
        pageSize: props.pageSize,
    })
    return { messages, setMessages, ...pagination }
}

describe("usePaginatedMessages", () => {
    describe("isInitialLoading / gating", () => {
        it("is false (no spinner) when conversationId is undefined, even with no data", () => {
            const { Wrapper } = createQueryWrapper()
            const { result } = renderHook(() => useHarness({ conversationId: undefined, initialMessages: [] }), {
                wrapper: Wrapper,
            })

            expect(result.current.isInitialLoading).toBe(false)
            expect(listMessagesMock).not.toHaveBeenCalled()
        })

        it("is true immediately on mount while the page-1 fetch is in flight, then false once it resolves", async () => {
            const { promise, resolve } = deferred<Paginated<MessageDTO>>()
            listMessagesMock.mockReturnValueOnce(promise)
            const { Wrapper } = createQueryWrapper()

            const { result } = renderHook(
                () => useHarness({ conversationId: "conv_1", initialMessages: [], pageSize: 20 }),
                { wrapper: Wrapper }
            )

            expect(result.current.isInitialLoading).toBe(true)

            await act(async () => {
                resolve(page([messageDTO("m1")]))
                await flushAsync()
                await flushAsync()
            })

            expect(result.current.isInitialLoading).toBe(false)
        })

        it("fetches page 1 with the expected params (page, page_size, sort)", async () => {
            listMessagesMock.mockResolvedValueOnce(page([messageDTO("m1")], { page_size: 7 }))
            const { Wrapper } = createQueryWrapper()

            await act(async () => {
                renderHook(() => useHarness({ conversationId: "conv_1", initialMessages: [], pageSize: 7 }), {
                    wrapper: Wrapper,
                })
                await flushAsync()
            })

            expect(listMessagesMock).toHaveBeenCalledWith("conv_1", { page: 1, page_size: 7, sort: "-created_at" })
        })

        it("reverses the server's newest-first page into oldest-first display order", async () => {
            listMessagesMock.mockResolvedValueOnce(page([messageDTO("newer"), messageDTO("older")]))
            const { Wrapper } = createQueryWrapper()

            const { result } = renderHook(
                () => useHarness({ conversationId: "conv_1", initialMessages: [], pageSize: 20 }),
                { wrapper: Wrapper }
            )

            await act(async () => {
                await flushAsync()
                await flushAsync()
            })

            expect(result.current.messages.map((m) => m.id)).toEqual(["older", "newer"])
        })

        it("treats a 404 on the initial fetch as 'no conversation yet' and hydrates an empty list without throwing", async () => {
            listMessagesMock.mockRejectedValueOnce(new ApiError("not found", 404))
            const { Wrapper } = createQueryWrapper()

            const { result } = renderHook(
                () => useHarness({ conversationId: "conv_1", initialMessages: [], pageSize: 20 }),
                { wrapper: Wrapper }
            )

            await act(async () => {
                await flushAsync()
                await flushAsync()
            })

            expect(result.current.messages).toEqual([])
            expect(result.current.hasMore).toBe(false)
            expect(result.current.isInitialLoading).toBe(false)
        })

        it("skips the page-1 fetch entirely when the messages cache is already pre-populated for this conversationId", async () => {
            const { queryClient, Wrapper } = createQueryWrapper()
            const cached = [seedMessage("c1"), seedMessage("c2")]
            queryClient.setQueryData(messagesCacheKeyMock("conv_1", 20), cached)

            const { result } = renderHook(
                () => useHarness({ conversationId: "conv_1", initialMessages: [], pageSize: 20 }),
                { wrapper: Wrapper }
            )

            await act(async () => {
                await flushAsync()
            })

            expect(listMessagesMock).not.toHaveBeenCalled()
            expect(result.current.isInitialLoading).toBe(false)
            expect(result.current.messages).toEqual(cached)
        })
    })

    describe("hydration effect", () => {
        it("does not overwrite local state when initialMessages is already non-empty (mid-stream case)", async () => {
            listMessagesMock.mockResolvedValueOnce(page([messageDTO("server-1")]))
            const { Wrapper } = createQueryWrapper()
            const existing = [seedMessage("local-1")]

            const { result } = renderHook(
                () => useHarness({ conversationId: "conv_1", initialMessages: existing, pageSize: 20 }),
                { wrapper: Wrapper }
            )

            await act(async () => {
                await flushAsync()
                await flushAsync()
            })

            // The hydration effect fetched server data (fetch fires regardless
            // of initialMessages, since there is no pre-existing cache) but
            // must NOT stomp on messages the parent already has mid-stream.
            expect(result.current.messages).toEqual(existing)
        })

        it("does not re-hydrate for the same conversationId when the query cache is updated later (e.g. background refetch)", async () => {
            listMessagesMock.mockResolvedValueOnce(page([messageDTO("m1")]))
            const { queryClient, Wrapper } = createQueryWrapper()

            const { result } = renderHook(
                () => useHarness({ conversationId: "conv_1", initialMessages: [], pageSize: 20 }),
                { wrapper: Wrapper }
            )

            await act(async () => {
                await flushAsync()
                await flushAsync()
            })
            expect(result.current.messages.map((m) => m.id)).toEqual(["m1"])

            await act(async () => {
                queryClient.setQueryData(messagesCacheKeyMock("conv_1", 20), [seedMessage("background-refetch")])
                await flushAsync()
            })

            // hydratedRef already latched onto "conv_1" -> local state must stay put.
            expect(result.current.messages.map((m) => m.id)).toEqual(["m1"])
        })

        it("hydrates again for a new conversationId (hydratedRef is per-conversation)", async () => {
            listMessagesMock.mockResolvedValueOnce(page([messageDTO("conv1-msg")]))
            const { Wrapper } = createQueryWrapper()

            const { result, rerender } = renderHook(
                (props: { conversationId: string }) =>
                    useHarness({ conversationId: props.conversationId, initialMessages: [], pageSize: 20 }),
                { wrapper: Wrapper, initialProps: { conversationId: "conv_1" } }
            )

            await act(async () => {
                await flushAsync()
                await flushAsync()
            })
            expect(result.current.messages.map((m) => m.id)).toEqual(["conv1-msg"])

            listMessagesMock.mockResolvedValueOnce(page([messageDTO("conv2-msg")]))
            rerender({ conversationId: "conv_2" })

            await act(async () => {
                await flushAsync()
                await flushAsync()
            })

            expect(result.current.messages.map((m) => m.id)).toEqual(["conv2-msg"])
        })
    })

    describe("loadMore", () => {
        it("does nothing and returns null when conversationId is undefined", async () => {
            const { Wrapper } = createQueryWrapper()
            const { result } = renderHook(
                () => useHarness({ conversationId: undefined, initialMessages: [], pageSize: 20 }),
                { wrapper: Wrapper }
            )

            let returned: Message[] | null = undefined as never
            await act(async () => {
                returned = await result.current.loadMore()
            })

            expect(returned).toBeNull()
            expect(listMessagesMock).not.toHaveBeenCalled()
        })

        it("does nothing when hasMore is already false", async () => {
            // First loadMore reveals the tail (fewer than pageSize items -> hasMore=false).
            const { queryClient, Wrapper } = createQueryWrapper()
            const seed = [seedMessage("s1"), seedMessage("s2")]
            queryClient.setQueryData(messagesCacheKeyMock("conv_1", 2), seed)
            const { result } = renderHook(
                () => useHarness({ conversationId: "conv_1", initialMessages: seed, pageSize: 2 }),
                { wrapper: Wrapper }
            )
            await act(async () => {
                await flushAsync()
            })

            listMessagesMock.mockResolvedValueOnce(page([messageDTO("only-one")], { page_size: 2 }))
            await act(async () => {
                await result.current.loadMore()
            })
            expect(result.current.hasMore).toBe(false)
            listMessagesMock.mockClear()

            const second = await act(async () => result.current.loadMore())
            expect(second).toBeNull()
            expect(listMessagesMock).not.toHaveBeenCalled()
        })

        it("does not start a second fetch while one is already in flight (checked after a render)", async () => {
            const { queryClient, Wrapper } = createQueryWrapper()
            const seed = Array.from({ length: 20 }, (_, i) => seedMessage(`s${i}`))
            queryClient.setQueryData(messagesCacheKeyMock("conv_1", 20), seed)
            const { result } = renderHook(
                () => useHarness({ conversationId: "conv_1", initialMessages: seed, pageSize: 20 }),
                { wrapper: Wrapper }
            )
            await act(async () => {
                await flushAsync()
            })

            const first = deferred<Paginated<MessageDTO>>()
            listMessagesMock.mockReturnValueOnce(first.promise)

            let pending1!: Promise<Message[] | null>
            act(() => {
                pending1 = result.current.loadMore()
            })
            expect(listMessagesMock).toHaveBeenCalledTimes(1)
            expect(result.current.isLoadingMore).toBe(true)

            let pending2: Promise<Message[] | null> | undefined
            act(() => {
                pending2 = result.current.loadMore()
            })
            expect(listMessagesMock).toHaveBeenCalledTimes(1)
            await expect(pending2).resolves.toBeNull()

            await act(async () => {
                first.resolve(page([messageDTO("older-page")], { page_size: 20 }))
                await pending1
            })
            expect(result.current.isLoadingMore).toBe(false)
        })

        it("prepends unique older messages, updates pageRef, and mirrors the cache to the new head", async () => {
            const { queryClient, Wrapper } = createQueryWrapper()
            const seed = [seedMessage("m2"), seedMessage("m3")]
            queryClient.setQueryData(messagesCacheKeyMock("conv_1", 2), seed)
            const { result } = renderHook(
                () => useHarness({ conversationId: "conv_1", initialMessages: seed, pageSize: 2 }),
                { wrapper: Wrapper }
            )
            await act(async () => {
                await flushAsync()
            })

            listMessagesMock.mockResolvedValueOnce(page([messageDTO("m1")], { page_size: 2 }))
            let returned: Message[] | null = null
            await act(async () => {
                returned = await result.current.loadMore()
            })

            expect(result.current.messages.map((m) => m.id)).toEqual(["m1", "m2", "m3"])
            expect(returned!.map((m) => m.id)).toEqual(["m1"])
            expect(listMessagesMock).toHaveBeenCalledWith("conv_1", { page: 2, page_size: 2, sort: "-created_at" })

            const cached = queryClient.getQueryData<Message[]>(messagesCacheKeyMock("conv_1", 2))
            // Cache mirrors only the head (pageSize) of the merged list.
            expect(cached?.map((m) => m.id)).toEqual(["m1", "m2"])
        })

        it("dedups by id: only genuinely-new messages are prepended when a page overlaps existing state", async () => {
            const { queryClient, Wrapper } = createQueryWrapper()
            const seed = [seedMessage("m2"), seedMessage("m3")]
            queryClient.setQueryData(messagesCacheKeyMock("conv_1", 2), seed)
            const { result } = renderHook(
                () => useHarness({ conversationId: "conv_1", initialMessages: seed, pageSize: 2 }),
                { wrapper: Wrapper }
            )
            await act(async () => {
                await flushAsync()
            })

            // Server page includes one brand-new id and one id we already have (m2).
            listMessagesMock.mockResolvedValueOnce(page([messageDTO("m2"), messageDTO("m1")], { page_size: 2 }))
            await act(async () => {
                await result.current.loadMore()
            })

            expect(result.current.messages.map((m) => m.id)).toEqual(["m1", "m2", "m3"])
            expect(result.current.hasMore).toBe(true)
        })

        // =====================================================================
        // Regression test for a bug found while testing:
        // components/playground/hooks/use-paginated-messages.ts (`loadMore`).
        // `loadMore` used to use a closure-captured `appendedZero` flag, set
        // to `true` INSIDE the `setMessages((prev) => {...})` functional
        // updater, then read immediately afterwards
        // (`if (appendedZero) setHasMore(false)`) to detect "every item in
        // this page was already present -> stop paginating".
        // That relied on React synchronously invoking the `setMessages`
        // updater function before the very next line ran — which React does
        // NOT guarantee. Concretely, `setIsLoadingMore(true)` (a few lines
        // above, before the `await`) already schedules a pending update on
        // the same fiber; by the time `setMessages(...)` is called, React
        // skips its "eager state" synchronous-invoke optimization (only
        // applies when there is no other pending update queued for the
        // fiber) and instead defers calling the updater function until the
        // render/commit phase. So `appendedZero` was still `false` — its
        // initial value — when `if (appendedZero)` ran, and
        // `setHasMore(false)` was never called: `hasMore` stayed `true`
        // forever for an all-duplicate page.
        // Fixed by computing the dedup synchronously against
        // `initialMessages` (the live, current list) *before* touching any
        // state, and calling `setHasMore(false)` directly and unconditionally
        // in that branch — no more depending on timing-sensitive functional-
        // updater side effects.
        // =====================================================================
        it(
            "sets hasMore=false when every item in the page is already present (fully duplicate page)",
            async () => {
                const { queryClient, Wrapper } = createQueryWrapper()
                const seed = [seedMessage("m2"), seedMessage("m3")]
                queryClient.setQueryData(messagesCacheKeyMock("conv_1", 2), seed)
                const { result } = renderHook(
                    () => useHarness({ conversationId: "conv_1", initialMessages: seed, pageSize: 2 }),
                    { wrapper: Wrapper }
                )
                await act(async () => {
                    await flushAsync()
                })

                // Server returns a full page, but both ids are already in state.
                listMessagesMock.mockResolvedValueOnce(page([messageDTO("m2"), messageDTO("m3")], { page_size: 2 }))
                let returned: Message[] | null = null
                await act(async () => {
                    returned = await result.current.loadMore()
                })

                expect(result.current.messages.map((m) => m.id)).toEqual(["m2", "m3"])
                expect(result.current.hasMore).toBe(false)
                // Still reports the (all-duplicate) page items as the raw
                // return value, reversed into oldest-first display order —
                // callers like `preserveScrollPosition` only care that a
                // fetch happened, not whether it changed state.
                expect(returned!.map((m) => m.id)).toEqual(["m3", "m2"])
            },
        )

        it(
            "does NOT flip hasMore=false on a full page that is only PARTIALLY duplicate",
            async () => {
                const { queryClient, Wrapper } = createQueryWrapper()
                const seed = [seedMessage("m2"), seedMessage("m3")]
                queryClient.setQueryData(messagesCacheKeyMock("conv_1", 2), seed)
                const { result } = renderHook(
                    () => useHarness({ conversationId: "conv_1", initialMessages: seed, pageSize: 2 }),
                    { wrapper: Wrapper }
                )
                await act(async () => {
                    await flushAsync()
                })

                // Full page (2 items), one brand-new + one already-seen.
                listMessagesMock.mockResolvedValueOnce(page([messageDTO("m1"), messageDTO("m2")], { page_size: 2 }))
                await act(async () => {
                    await result.current.loadMore()
                })

                expect(result.current.messages.map((m) => m.id)).toEqual(["m1", "m2", "m3"])
                expect(result.current.hasMore).toBe(true)
            },
        )

        it("treats a 404 on loadMore as end-of-history: hasMore=false, null return, no console.error", async () => {
            const { queryClient, Wrapper } = createQueryWrapper()
            const seed = [seedMessage("m1")]
            queryClient.setQueryData(messagesCacheKeyMock("conv_1", 20), seed)
            const { result } = renderHook(
                () => useHarness({ conversationId: "conv_1", initialMessages: seed, pageSize: 20 }),
                { wrapper: Wrapper }
            )
            await act(async () => {
                await flushAsync()
            })

            const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined)
            listMessagesMock.mockRejectedValueOnce(new ApiError("not found", 404))

            let returned: Message[] | null = null
            await act(async () => {
                returned = await result.current.loadMore()
            })

            expect(returned).toBeNull()
            expect(result.current.hasMore).toBe(false)
            expect(result.current.isLoadingMore).toBe(false)
            expect(consoleErrorSpy).not.toHaveBeenCalled()
            consoleErrorSpy.mockRestore()
        })

        it("logs and returns null on a generic error, without touching hasMore", async () => {
            const { queryClient, Wrapper } = createQueryWrapper()
            const seed = [seedMessage("m1")]
            queryClient.setQueryData(messagesCacheKeyMock("conv_1", 20), seed)
            const { result } = renderHook(
                () => useHarness({ conversationId: "conv_1", initialMessages: seed, pageSize: 20 }),
                { wrapper: Wrapper }
            )
            await act(async () => {
                await flushAsync()
            })

            const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined)
            listMessagesMock.mockRejectedValueOnce(new Error("upstream boom"))

            let returned: Message[] | null = null
            await act(async () => {
                returned = await result.current.loadMore()
            })

            expect(returned).toBeNull()
            expect(result.current.hasMore).toBe(true)
            expect(result.current.isLoadingMore).toBe(false)
            expect(consoleErrorSpy).toHaveBeenCalledWith("Failed to load more messages", expect.any(Error))
            consoleErrorSpy.mockRestore()
        })
    })
})
