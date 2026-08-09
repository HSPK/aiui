import { renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { createQueryWrapper } from "../_render"

const invalidateListMock = vi.hoisted(() => vi.fn())
const messagesCacheKeyMock = vi.hoisted(() =>
    vi.fn((conversationId: string, pageSize: number) => ["conversations", conversationId, "messages-cache", pageSize])
)
vi.mock("@/lib/api/conversations", () => ({
    conversations: {
        useInvalidateList: () => invalidateListMock,
        messagesCacheKey: messagesCacheKeyMock,
    },
}))

 
import { useMessageSync } from "@/components/playground/hooks/use-message-sync"
 
import type { Message } from "@/components/playground/chat/types"

function msg(id: string): Message {
    return { id, role: "assistant", content: `content-${id}` }
}

afterEach(() => {
    invalidateListMock.mockClear()
    messagesCacheKeyMock.mockClear()
})

describe("useMessageSync", () => {
    it("does not invalidate on mount, regardless of the initial isLoading value", () => {
        const { queryClient, Wrapper } = createQueryWrapper()
        renderHook(() => useMessageSync({ conversationId: "conv_1", messages: [msg("m1")], isLoading: true, pageSize: 20 }), {
            wrapper: Wrapper,
        })
        expect(invalidateListMock).not.toHaveBeenCalled()

        renderHook(() => useMessageSync({ conversationId: "conv_2", messages: [], isLoading: false, pageSize: 20 }), {
            wrapper: createQueryWrapper(queryClient).Wrapper,
        })
        expect(invalidateListMock).not.toHaveBeenCalled()
    })

    it("invalidates the conversation list exactly once when isLoading transitions true -> false", () => {
        const { Wrapper } = createQueryWrapper()
        const { rerender } = renderHook(
            (props: { isLoading: boolean }) =>
                useMessageSync({ conversationId: "conv_1", messages: [msg("m1")], isLoading: props.isLoading, pageSize: 20 }),
            { wrapper: Wrapper, initialProps: { isLoading: true } }
        )
        expect(invalidateListMock).not.toHaveBeenCalled()

        rerender({ isLoading: false })
        expect(invalidateListMock).toHaveBeenCalledTimes(1)

        // Re-rendering with the same (false) value must not re-fire.
        rerender({ isLoading: false })
        expect(invalidateListMock).toHaveBeenCalledTimes(1)
    })

    it("does NOT invalidate on a false -> true transition (only completion, not start)", () => {
        const { Wrapper } = createQueryWrapper()
        const { rerender } = renderHook(
            (props: { isLoading: boolean }) =>
                useMessageSync({ conversationId: "conv_1", messages: [msg("m1")], isLoading: props.isLoading, pageSize: 20 }),
            { wrapper: Wrapper, initialProps: { isLoading: false } }
        )

        rerender({ isLoading: true })
        expect(invalidateListMock).not.toHaveBeenCalled()
    })

    it("writes the message tail into the per-conversation cache once loading finishes", () => {
        const { queryClient, Wrapper } = createQueryWrapper()
        const messages = [msg("m1"), msg("m2"), msg("m3")]
        const { rerender } = renderHook(
            (props: { isLoading: boolean }) =>
                useMessageSync({ conversationId: "conv_1", messages, isLoading: props.isLoading, pageSize: 2 }),
            { wrapper: Wrapper, initialProps: { isLoading: true } }
        )

        rerender({ isLoading: false })

        expect(messagesCacheKeyMock).toHaveBeenCalledWith("conv_1", 2)
        const cached = queryClient.getQueryData(["conversations", "conv_1", "messages-cache", 2])
        expect(cached).toEqual([msg("m2"), msg("m3")])
    })

    it("skips writing the cache when conversationId is undefined, but still invalidates the list", () => {
        const { queryClient, Wrapper } = createQueryWrapper()
        const { rerender } = renderHook(
            (props: { isLoading: boolean }) =>
                useMessageSync({ conversationId: undefined, messages: [msg("m1")], isLoading: props.isLoading, pageSize: 20 }),
            { wrapper: Wrapper, initialProps: { isLoading: true } }
        )

        rerender({ isLoading: false })

        expect(invalidateListMock).toHaveBeenCalledTimes(1)
        expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
    })

    it("skips writing the cache when messages is empty, but still invalidates the list", () => {
        const { queryClient, Wrapper } = createQueryWrapper()
        const { rerender } = renderHook(
            (props: { isLoading: boolean }) =>
                useMessageSync({ conversationId: "conv_1", messages: [], isLoading: props.isLoading, pageSize: 20 }),
            { wrapper: Wrapper, initialProps: { isLoading: true } }
        )

        rerender({ isLoading: false })

        expect(invalidateListMock).toHaveBeenCalledTimes(1)
        expect(queryClient.getQueryData(["conversations", "conv_1", "messages-cache", 20])).toBeUndefined()
    })

    it("re-fires on a second isLoading true->false cycle for the same conversation", () => {
        const { Wrapper } = createQueryWrapper()
        const { rerender } = renderHook(
            (props: { isLoading: boolean }) =>
                useMessageSync({ conversationId: "conv_1", messages: [msg("m1")], isLoading: props.isLoading, pageSize: 20 }),
            { wrapper: Wrapper, initialProps: { isLoading: true } }
        )

        rerender({ isLoading: false })
        expect(invalidateListMock).toHaveBeenCalledTimes(1)

        rerender({ isLoading: true })
        rerender({ isLoading: false })
        expect(invalidateListMock).toHaveBeenCalledTimes(2)
    })

    it("only keeps the last `pageSize` messages when writing the cache", () => {
        const { queryClient, Wrapper } = createQueryWrapper()
        const messages = [msg("m1"), msg("m2"), msg("m3"), msg("m4"), msg("m5")]
        const { rerender } = renderHook(
            (props: { isLoading: boolean }) =>
                useMessageSync({ conversationId: "conv_1", messages, isLoading: props.isLoading, pageSize: 3 }),
            { wrapper: Wrapper, initialProps: { isLoading: true } }
        )

        rerender({ isLoading: false })

        const cached = queryClient.getQueryData<Message[]>(["conversations", "conv_1", "messages-cache", 3])
        expect(cached).toHaveLength(3)
        expect(cached).toEqual([msg("m3"), msg("m4"), msg("m5")])
    })
})
