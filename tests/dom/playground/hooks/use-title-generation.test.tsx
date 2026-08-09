import { act, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { createQueryWrapper, flushAsync } from "../_render"

// ---- mocks (module shapes verified by reading lib/api/conversations.ts,
// lib/api/gateway.ts, lib/api/preferences.ts) ----
const invalidateConversationsMock = vi.hoisted(() => vi.fn())
const updateTitleMock = vi.hoisted(() => vi.fn())
const keysAllMock = vi.hoisted(() => vi.fn(() => ["conversations"] as const))
vi.mock("@/lib/api/conversations", () => ({
    conversations: {
        useInvalidate: () => invalidateConversationsMock,
        updateTitle: updateTitleMock,
        keys: { all: keysAllMock },
    },
}))

const generateTitleMock = vi.hoisted(() => vi.fn())
vi.mock("@/lib/api/gateway", () => ({
    gateway: { generateTitle: generateTitleMock },
}))

const useGetMock = vi.hoisted(() => vi.fn())
vi.mock("@/lib/api/preferences", () => ({
    preferences: { useGet: useGetMock },
}))

 
import { useTitleGeneration } from "@/components/playground/hooks/use-title-generation"
 
import type { Message } from "@/components/playground/chat/types"
 
import type { ConversationDTO } from "@/lib/schemas/conversation"
 
import type { Paginated } from "@/lib/schemas/common"

function msg(id: string, role: Message["role"], content: Message["content"]): Message {
    return { id, role, content }
}

function conversationDTO(id: string, title: string): ConversationDTO {
    return {
        id,
        user_id: "u1",
        title,
        config: {},
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
        is_deleted: false,
    }
}

type Props = {
    conversationId: string | undefined
    messages: Message[]
    isLoading: boolean
    getModelIds: () => string[]
}

afterEach(() => {
    useGetMock.mockReset()
    generateTitleMock.mockReset()
    updateTitleMock.mockReset()
})

describe("useTitleGeneration", () => {
    // =========================================================================
    // Fixed bug: components/playground/hooks/use-title-generation.ts used to
    // read `m.content.length > 10` directly. `Message.content` may be a
    // string OR a ContentPart[] (multimodal shape); for arrays, `.length` is
    // the PART COUNT (usually 1-3), not text length, so the guard was
    // essentially always false for realistic multimodal assistant turns —
    // even ones with plenty of text — silently suppressing title
    // auto-generation. Now measured via the same `extractText(...).length`
    // used for the actual gateway.generateTitle call.
    // =========================================================================
    it(
        "fires generateTitle for a substantial ARRAY-content assistant reply (extractText length, not part count)",
        async () => {
            useGetMock.mockReturnValue({ data: { default_summary_model: "", default_model: "" } })
            generateTitleMock.mockResolvedValue("Generated Title")
            updateTitleMock.mockResolvedValue(null)
            const { Wrapper } = createQueryWrapper()

            const messages: Message[] = [
                msg("u1", "user", "Hello, can you help me plan a trip?"),
                msg("a1", "assistant", [{ type: "text", text: "A".repeat(50) }]),
            ]
            const { rerender } = renderHook(
                (props: Props) => useTitleGeneration(props),
                {
                    wrapper: Wrapper,
                    initialProps: {
                        conversationId: "conv_1",
                        messages,
                        isLoading: true,
                        getModelIds: () => ["gpt-4o"],
                    },
                }
            )

            await act(async () => {
                rerender({ conversationId: "conv_1", messages, isLoading: false, getModelIds: () => ["gpt-4o"] })
                await flushAsync()
                await flushAsync()
            })

            // Intended/correct behavior: a substantial multimodal assistant
            // reply should trigger title generation, same as a substantial
            // string reply would.
            expect(generateTitleMock).toHaveBeenCalled()
        }
    )

    it("does NOT fire for a short ARRAY-content assistant reply (extractText length still gates correctly)", async () => {
        useGetMock.mockReturnValue({ data: { default_summary_model: "", default_model: "" } })
        generateTitleMock.mockResolvedValue("Generated Title")
        const { Wrapper } = createQueryWrapper()

        const messages: Message[] = [
            msg("u1", "user", "Hi"),
            msg("a1", "assistant", [{ type: "text", text: "Hey" }]),
        ]
        const { rerender } = renderHook((props: Props) => useTitleGeneration(props), {
            wrapper: Wrapper,
            initialProps: { conversationId: "conv_1", messages, isLoading: true, getModelIds: () => ["gpt-4o"] },
        })

        await act(async () => {
            rerender({ conversationId: "conv_1", messages, isLoading: false, getModelIds: () => ["gpt-4o"] })
            await flushAsync()
            await flushAsync()
        })

        expect(generateTitleMock).not.toHaveBeenCalled()
    })

    // =========================================================================
    // Guard: hasStreamedRef / prevLoadingRef transition detection
    // =========================================================================
    describe("only fires after an observed loading -> not-loading transition", () => {
        it("does not fire while isLoading stays true across renders", async () => {
            useGetMock.mockReturnValue({ data: { default_summary_model: "", default_model: "" } })
            const { Wrapper } = createQueryWrapper()
            const messages: Message[] = [
                msg("u1", "user", "A question that needs a real answer please."),
                msg("a1", "assistant", "This is a fairly long assistant reply for testing."),
            ]

            const { rerender } = renderHook((props: Props) => useTitleGeneration(props), {
                wrapper: Wrapper,
                initialProps: { conversationId: "conv_1", messages, isLoading: true, getModelIds: () => ["gpt-4o"] },
            })

            await act(async () => {
                rerender({ conversationId: "conv_1", messages, isLoading: true, getModelIds: () => ["gpt-4o"] })
                await flushAsync()
            })

            expect(generateTitleMock).not.toHaveBeenCalled()
        })

        it("does not fire on mount/reopen when isLoading starts (and stays) false", async () => {
            useGetMock.mockReturnValue({ data: { default_summary_model: "", default_model: "" } })
            const { Wrapper } = createQueryWrapper()
            const messages: Message[] = [
                msg("u1", "user", "A question that needs a real answer please."),
                msg("a1", "assistant", "This is a fairly long assistant reply for testing."),
            ]

            const { rerender } = renderHook((props: Props) => useTitleGeneration(props), {
                wrapper: Wrapper,
                initialProps: { conversationId: "conv_1", messages, isLoading: false, getModelIds: () => ["gpt-4o"] },
            })

            await act(async () => {
                // Some unrelated prop changes, isLoading never transitions through true.
                rerender({ conversationId: "conv_1", messages: [...messages], isLoading: false, getModelIds: () => ["gpt-4o"] })
                await flushAsync()
            })

            expect(generateTitleMock).not.toHaveBeenCalled()
        })

        it("fires exactly once after a genuine true -> false transition, with valid data", async () => {
            useGetMock.mockReturnValue({ data: { default_summary_model: "", default_model: "" } })
            generateTitleMock.mockResolvedValue("Generated Title")
            updateTitleMock.mockResolvedValue(null)
            const { Wrapper } = createQueryWrapper()
            const messages: Message[] = [
                msg("u1", "user", "A question that needs a real answer please."),
                msg("a1", "assistant", "This is a fairly long assistant reply for testing."),
            ]

            const { rerender } = renderHook((props: Props) => useTitleGeneration(props), {
                wrapper: Wrapper,
                initialProps: { conversationId: "conv_1", messages, isLoading: true, getModelIds: () => ["gpt-4o"] },
            })

            await act(async () => {
                rerender({ conversationId: "conv_1", messages, isLoading: false, getModelIds: () => ["gpt-4o"] })
                await flushAsync()
                await flushAsync()
            })

            expect(generateTitleMock).toHaveBeenCalledTimes(1)
            expect(generateTitleMock).toHaveBeenCalledWith({
                model: "gpt-4o",
                user: "A question that needs a real answer please.",
                assistant: "This is a fairly long assistant reply for testing.",
            })
        })
    })

    // =========================================================================
    // Guard: generatedRef per-conversationId dedup
    // =========================================================================
    describe("generatedRef dedup", () => {
        it("does not re-fire for the same conversationId on a second loading cycle", async () => {
            useGetMock.mockReturnValue({ data: { default_summary_model: "", default_model: "" } })
            generateTitleMock.mockResolvedValue("Generated Title")
            updateTitleMock.mockResolvedValue(null)
            const { Wrapper } = createQueryWrapper()
            // Stable reference across rerenders — isolates the isLoading cycle.
            const messages: Message[] = [
                msg("u1", "user", "A question that needs a real answer please."),
                msg("a1", "assistant", "This is a fairly long assistant reply for testing."),
            ]
            const getModelIds = () => ["gpt-4o"]

            const { rerender } = renderHook((props: Props) => useTitleGeneration(props), {
                wrapper: Wrapper,
                initialProps: { conversationId: "conv_1", messages, isLoading: true, getModelIds },
            })

            await act(async () => {
                rerender({ conversationId: "conv_1", messages, isLoading: false, getModelIds })
                await flushAsync()
                await flushAsync()
            })
            expect(generateTitleMock).toHaveBeenCalledTimes(1)

            await act(async () => {
                rerender({ conversationId: "conv_1", messages, isLoading: true, getModelIds })
                await flushAsync()
            })
            await act(async () => {
                rerender({ conversationId: "conv_1", messages, isLoading: false, getModelIds })
                await flushAsync()
                await flushAsync()
            })

            expect(generateTitleMock).toHaveBeenCalledTimes(1)
        })

        it("does fire again for a different conversationId (dedup is per-id, not global)", async () => {
            useGetMock.mockReturnValue({ data: { default_summary_model: "", default_model: "" } })
            generateTitleMock.mockResolvedValue("Generated Title")
            updateTitleMock.mockResolvedValue(null)
            const { Wrapper } = createQueryWrapper()
            const getModelIds = () => ["gpt-4o"]
            const messagesA: Message[] = [
                msg("u1", "user", "First conversation question here."),
                msg("a1", "assistant", "First conversation assistant reply, fairly long."),
            ]
            const messagesB: Message[] = [
                msg("u2", "user", "Second conversation question here."),
                msg("a2", "assistant", "Second conversation assistant reply, fairly long."),
            ]

            const { rerender } = renderHook((props: Props) => useTitleGeneration(props), {
                wrapper: Wrapper,
                initialProps: { conversationId: "conv_1", messages: messagesA, isLoading: true, getModelIds },
            })

            await act(async () => {
                rerender({ conversationId: "conv_1", messages: messagesA, isLoading: false, getModelIds })
                await flushAsync()
                await flushAsync()
            })
            expect(generateTitleMock).toHaveBeenCalledTimes(1)

            // Switch to a different conversation and run through a fresh cycle.
            await act(async () => {
                rerender({ conversationId: "conv_2", messages: messagesB, isLoading: true, getModelIds })
                await flushAsync()
            })
            await act(async () => {
                rerender({ conversationId: "conv_2", messages: messagesB, isLoading: false, getModelIds })
                await flushAsync()
                await flushAsync()
            })

            expect(generateTitleMock).toHaveBeenCalledTimes(2)
            expect(generateTitleMock).toHaveBeenLastCalledWith(
                expect.objectContaining({ user: "Second conversation question here." })
            )
        })
    })

    // =========================================================================
    // Guard: DEFAULT_TITLES cached-title skip
    // =========================================================================
    describe("cached sidebar title skip", () => {
        it("skips calling generateTitle when the sidebar cache already shows a non-default title", async () => {
            useGetMock.mockReturnValue({ data: { default_summary_model: "", default_model: "" } })
            const { queryClient, Wrapper } = createQueryWrapper()
            // The shared test QueryClient uses gcTime: 0. A query seeded via
            // setQueryData with no active observer is scheduled for GC via a
            // setTimeout(fn, 0) almost immediately, which can race ahead of
            // (and beat) the effect that reads it back out. Override gcTime
            // for this key prefix so the seeded entry survives long enough
            // to be read by readCachedTitle inside the hook's effect.
            queryClient.setQueryDefaults(["conversations"], { gcTime: Infinity })
            queryClient.setQueryData<Paginated<ConversationDTO>>(["conversations", "list", {}], {
                items: [conversationDTO("conv_1", "My Custom Title")],
                total: 1,
                page: 1,
                page_size: 20,
            })
            const messages: Message[] = [
                msg("u1", "user", "A question that needs a real answer please."),
                msg("a1", "assistant", "This is a fairly long assistant reply for testing."),
            ]

            const { rerender } = renderHook((props: Props) => useTitleGeneration(props), {
                wrapper: Wrapper,
                initialProps: { conversationId: "conv_1", messages, isLoading: true, getModelIds: () => ["gpt-4o"] },
            })

            await act(async () => {
                rerender({ conversationId: "conv_1", messages, isLoading: false, getModelIds: () => ["gpt-4o"] })
                await flushAsync()
            })

            expect(generateTitleMock).not.toHaveBeenCalled()
        })

        it("finds the cached title in an infinite-query ({ pages: [...] }) cache shape too", async () => {
            useGetMock.mockReturnValue({ data: { default_summary_model: "", default_model: "" } })
            const { queryClient, Wrapper } = createQueryWrapper()
            queryClient.setQueryDefaults(["conversations"], { gcTime: Infinity })
            queryClient.setQueryData(["conversations", "infinite", {}], {
                pages: [
                    { items: [conversationDTO("conv_0", "Other Conv")], total: 2, page: 1, page_size: 20 },
                    { items: [conversationDTO("conv_1", "My Custom Title")], total: 2, page: 2, page_size: 20 },
                ],
                pageParams: [1, 2],
            })
            const messages: Message[] = [
                msg("u1", "user", "A question that needs a real answer please."),
                msg("a1", "assistant", "This is a fairly long assistant reply for testing."),
            ]

            const { rerender } = renderHook((props: Props) => useTitleGeneration(props), {
                wrapper: Wrapper,
                initialProps: { conversationId: "conv_1", messages, isLoading: true, getModelIds: () => ["gpt-4o"] },
            })

            await act(async () => {
                rerender({ conversationId: "conv_1", messages, isLoading: false, getModelIds: () => ["gpt-4o"] })
                await flushAsync()
            })

            // A real (non-default) title was found across the paginated
            // cache shape, so generation is skipped exactly like the flat
            // Paginated<T> shape above.
            expect(generateTitleMock).not.toHaveBeenCalled()
        })

        it("tolerates a cache entry with no data yet and one with a missing items array", async () => {
            useGetMock.mockReturnValue({ data: { default_summary_model: "", default_model: "" } })
            generateTitleMock.mockResolvedValue("Generated Title")
            updateTitleMock.mockResolvedValue(null)
            const { queryClient, Wrapper } = createQueryWrapper()
            queryClient.setQueryDefaults(["conversations"], { gcTime: Infinity })
            // A query that hasn't resolved yet (data undefined) must be
            // skipped, not crash `readCachedTitle`.
            queryClient.setQueryData(["conversations", "pending", {}], undefined)
            // A cache entry with no `.items` at all must fall back to `[]`
            // instead of throwing.
            queryClient.setQueryData(["conversations", "list", {}], {
                total: 0,
                page: 1,
                page_size: 20,
            })
            const messages: Message[] = [
                msg("u1", "user", "A question that needs a real answer please."),
                msg("a1", "assistant", "This is a fairly long assistant reply for testing."),
            ]

            const { rerender } = renderHook((props: Props) => useTitleGeneration(props), {
                wrapper: Wrapper,
                initialProps: { conversationId: "conv_1", messages, isLoading: true, getModelIds: () => ["gpt-4o"] },
            })

            await act(async () => {
                rerender({ conversationId: "conv_1", messages, isLoading: false, getModelIds: () => ["gpt-4o"] })
                await flushAsync()
                await flushAsync()
            })

            // Neither cache entry matched conv_1, so no cached title was
            // found and generation proceeds normally.
            expect(generateTitleMock).toHaveBeenCalledTimes(1)
        })

        it("still calls generateTitle when the cached title is one of the DEFAULT_TITLES", async () => {
            useGetMock.mockReturnValue({ data: { default_summary_model: "", default_model: "" } })
            generateTitleMock.mockResolvedValue("Generated Title")
            updateTitleMock.mockResolvedValue(null)
            const { queryClient, Wrapper } = createQueryWrapper()
            queryClient.setQueryDefaults(["conversations"], { gcTime: Infinity })
            queryClient.setQueryData<Paginated<ConversationDTO>>(["conversations", "list", {}], {
                items: [conversationDTO("conv_1", "New Chat")],
                total: 1,
                page: 1,
                page_size: 20,
            })
            const messages: Message[] = [
                msg("u1", "user", "A question that needs a real answer please."),
                msg("a1", "assistant", "This is a fairly long assistant reply for testing."),
            ]

            const { rerender } = renderHook((props: Props) => useTitleGeneration(props), {
                wrapper: Wrapper,
                initialProps: { conversationId: "conv_1", messages, isLoading: true, getModelIds: () => ["gpt-4o"] },
            })

            await act(async () => {
                rerender({ conversationId: "conv_1", messages, isLoading: false, getModelIds: () => ["gpt-4o"] })
                await flushAsync()
                await flushAsync()
            })

            expect(generateTitleMock).toHaveBeenCalledTimes(1)
        })
    })

    // =========================================================================
    // expectedTitle compare-and-swap value
    // =========================================================================
    describe("expectedTitle passed to conversations.updateTitle", () => {
        it("passes '' when there is no cached title at all", async () => {
            useGetMock.mockReturnValue({ data: { default_summary_model: "", default_model: "" } })
            generateTitleMock.mockResolvedValue("Generated Title")
            updateTitleMock.mockResolvedValue(null)
            const { Wrapper } = createQueryWrapper()
            const messages: Message[] = [
                msg("u1", "user", "A question that needs a real answer please."),
                msg("a1", "assistant", "This is a fairly long assistant reply for testing."),
            ]

            const { rerender } = renderHook((props: Props) => useTitleGeneration(props), {
                wrapper: Wrapper,
                initialProps: { conversationId: "conv_1", messages, isLoading: true, getModelIds: () => ["gpt-4o"] },
            })

            await act(async () => {
                rerender({ conversationId: "conv_1", messages, isLoading: false, getModelIds: () => ["gpt-4o"] })
                await flushAsync()
                await flushAsync()
            })

            expect(updateTitleMock).toHaveBeenCalledWith("conv_1", "Generated Title", "")
        })

        it("passes the observed cached (default) title as the compare-and-swap value", async () => {
            useGetMock.mockReturnValue({ data: { default_summary_model: "", default_model: "" } })
            generateTitleMock.mockResolvedValue("Generated Title")
            updateTitleMock.mockResolvedValue(null)
            const { queryClient, Wrapper } = createQueryWrapper()
            queryClient.setQueryDefaults(["conversations"], { gcTime: Infinity })
            queryClient.setQueryData<Paginated<ConversationDTO>>(["conversations", "list", {}], {
                items: [conversationDTO("conv_1", "New Chat")],
                total: 1,
                page: 1,
                page_size: 20,
            })
            const messages: Message[] = [
                msg("u1", "user", "A question that needs a real answer please."),
                msg("a1", "assistant", "This is a fairly long assistant reply for testing."),
            ]

            const { rerender } = renderHook((props: Props) => useTitleGeneration(props), {
                wrapper: Wrapper,
                initialProps: { conversationId: "conv_1", messages, isLoading: true, getModelIds: () => ["gpt-4o"] },
            })

            await act(async () => {
                rerender({ conversationId: "conv_1", messages, isLoading: false, getModelIds: () => ["gpt-4o"] })
                await flushAsync()
                await flushAsync()
            })

            expect(updateTitleMock).toHaveBeenCalledWith("conv_1", "Generated Title", "New Chat")
        })
    })

    // =========================================================================
    // Guard: missing summaryModel bail-out
    // =========================================================================
    describe("summary model resolution", () => {
        it("does not call generateTitle when prefs and getModelIds() are all empty", async () => {
            useGetMock.mockReturnValue({ data: { default_summary_model: "", default_model: "" } })
            const { Wrapper } = createQueryWrapper()
            const messages: Message[] = [
                msg("u1", "user", "A question that needs a real answer please."),
                msg("a1", "assistant", "This is a fairly long assistant reply for testing."),
            ]

            const { rerender } = renderHook((props: Props) => useTitleGeneration(props), {
                wrapper: Wrapper,
                initialProps: { conversationId: "conv_1", messages, isLoading: true, getModelIds: () => [] },
            })

            await act(async () => {
                rerender({ conversationId: "conv_1", messages, isLoading: false, getModelIds: () => [] })
                await flushAsync()
            })

            expect(generateTitleMock).not.toHaveBeenCalled()
        })

        it("prefers default_summary_model over default_model and getModelIds()", async () => {
            useGetMock.mockReturnValue({
                data: { default_summary_model: "summary-model", default_model: "chat-model" },
            })
            generateTitleMock.mockResolvedValue("Generated Title")
            updateTitleMock.mockResolvedValue(null)
            const { Wrapper } = createQueryWrapper()
            const messages: Message[] = [
                msg("u1", "user", "A question that needs a real answer please."),
                msg("a1", "assistant", "This is a fairly long assistant reply for testing."),
            ]

            const { rerender } = renderHook((props: Props) => useTitleGeneration(props), {
                wrapper: Wrapper,
                initialProps: { conversationId: "conv_1", messages, isLoading: true, getModelIds: () => ["fallback-model"] },
            })

            await act(async () => {
                rerender({ conversationId: "conv_1", messages, isLoading: false, getModelIds: () => ["fallback-model"] })
                await flushAsync()
                await flushAsync()
            })

            expect(generateTitleMock).toHaveBeenCalledWith(expect.objectContaining({ model: "summary-model" }))
        })

        it("falls back to default_model when default_summary_model is empty", async () => {
            useGetMock.mockReturnValue({ data: { default_summary_model: "", default_model: "chat-model" } })
            generateTitleMock.mockResolvedValue("Generated Title")
            updateTitleMock.mockResolvedValue(null)
            const { Wrapper } = createQueryWrapper()
            const messages: Message[] = [
                msg("u1", "user", "A question that needs a real answer please."),
                msg("a1", "assistant", "This is a fairly long assistant reply for testing."),
            ]

            const { rerender } = renderHook((props: Props) => useTitleGeneration(props), {
                wrapper: Wrapper,
                initialProps: { conversationId: "conv_1", messages, isLoading: true, getModelIds: () => ["fallback-model"] },
            })

            await act(async () => {
                rerender({ conversationId: "conv_1", messages, isLoading: false, getModelIds: () => ["fallback-model"] })
                await flushAsync()
                await flushAsync()
            })

            expect(generateTitleMock).toHaveBeenCalledWith(expect.objectContaining({ model: "chat-model" }))
        })

        it("falls back to getModelIds()[0] when both prefs fields are empty", async () => {
            useGetMock.mockReturnValue({ data: { default_summary_model: "", default_model: "" } })
            generateTitleMock.mockResolvedValue("Generated Title")
            updateTitleMock.mockResolvedValue(null)
            const { Wrapper } = createQueryWrapper()
            const messages: Message[] = [
                msg("u1", "user", "A question that needs a real answer please."),
                msg("a1", "assistant", "This is a fairly long assistant reply for testing."),
            ]

            const { rerender } = renderHook((props: Props) => useTitleGeneration(props), {
                wrapper: Wrapper,
                initialProps: { conversationId: "conv_1", messages, isLoading: true, getModelIds: () => ["fallback-model", "other"] },
            })

            await act(async () => {
                rerender({
                    conversationId: "conv_1",
                    messages,
                    isLoading: false,
                    getModelIds: () => ["fallback-model", "other"],
                })
                await flushAsync()
                await flushAsync()
            })

            expect(generateTitleMock).toHaveBeenCalledWith(expect.objectContaining({ model: "fallback-model" }))
        })

        it("falls back to getModelIds()[0] when default_summary_model/default_model are undefined (not just empty strings)", async () => {
            // Covers the `?? ""` fallback itself, as opposed to the
            // above tests which pass through already-empty strings.
            useGetMock.mockReturnValue({ data: {} })
            generateTitleMock.mockResolvedValue("Generated Title")
            updateTitleMock.mockResolvedValue(null)
            const { Wrapper } = createQueryWrapper()
            const messages: Message[] = [
                msg("u1", "user", "A question that needs a real answer please."),
                msg("a1", "assistant", "This is a fairly long assistant reply for testing."),
            ]

            const { rerender } = renderHook((props: Props) => useTitleGeneration(props), {
                wrapper: Wrapper,
                initialProps: { conversationId: "conv_1", messages, isLoading: true, getModelIds: () => ["fallback-model"] },
            })

            await act(async () => {
                rerender({ conversationId: "conv_1", messages, isLoading: false, getModelIds: () => ["fallback-model"] })
                await flushAsync()
                await flushAsync()
            })

            expect(generateTitleMock).toHaveBeenCalledWith(expect.objectContaining({ model: "fallback-model" }))
        })
    })

    // =========================================================================
    // Other guards: conversationId presence, message count, missing roles
    // =========================================================================
    describe("other early-exit guards", () => {
        it("does not fire when conversationId is undefined", async () => {
            useGetMock.mockReturnValue({ data: { default_summary_model: "", default_model: "" } })
            const { Wrapper } = createQueryWrapper()
            const messages: Message[] = [
                msg("u1", "user", "A question that needs a real answer please."),
                msg("a1", "assistant", "This is a fairly long assistant reply for testing."),
            ]

            const { rerender } = renderHook((props: Props) => useTitleGeneration(props), {
                wrapper: Wrapper,
                initialProps: { conversationId: undefined, messages, isLoading: true, getModelIds: () => ["gpt-4o"] },
            })

            await act(async () => {
                rerender({ conversationId: undefined, messages, isLoading: false, getModelIds: () => ["gpt-4o"] })
                await flushAsync()
            })

            expect(generateTitleMock).not.toHaveBeenCalled()
        })

        it("does not fire when there are fewer than 2 messages", async () => {
            useGetMock.mockReturnValue({ data: { default_summary_model: "", default_model: "" } })
            const { Wrapper } = createQueryWrapper()
            const messages: Message[] = [msg("a1", "assistant", "This is a fairly long assistant reply for testing.")]

            const { rerender } = renderHook((props: Props) => useTitleGeneration(props), {
                wrapper: Wrapper,
                initialProps: { conversationId: "conv_1", messages, isLoading: true, getModelIds: () => ["gpt-4o"] },
            })

            await act(async () => {
                rerender({ conversationId: "conv_1", messages, isLoading: false, getModelIds: () => ["gpt-4o"] })
                await flushAsync()
            })

            expect(generateTitleMock).not.toHaveBeenCalled()
        })

        it("does not fire when there is no user message", async () => {
            useGetMock.mockReturnValue({ data: { default_summary_model: "", default_model: "" } })
            const { Wrapper } = createQueryWrapper()
            const messages: Message[] = [
                msg("a1", "assistant", "This is a fairly long assistant reply for testing."),
                msg("a2", "assistant", "Another fairly long assistant reply for testing."),
            ]

            const { rerender } = renderHook((props: Props) => useTitleGeneration(props), {
                wrapper: Wrapper,
                initialProps: { conversationId: "conv_1", messages, isLoading: true, getModelIds: () => ["gpt-4o"] },
            })

            await act(async () => {
                rerender({ conversationId: "conv_1", messages, isLoading: false, getModelIds: () => ["gpt-4o"] })
                await flushAsync()
            })

            expect(generateTitleMock).not.toHaveBeenCalled()
        })

        it("does not fire when there is no assistant message (or content.length <= 10)", async () => {
            useGetMock.mockReturnValue({ data: { default_summary_model: "", default_model: "" } })
            const { Wrapper } = createQueryWrapper()
            const messages: Message[] = [
                msg("u1", "user", "A question that needs a real answer please."),
                msg("u2", "user", "Another user message, still no assistant reply."),
            ]

            const { rerender } = renderHook((props: Props) => useTitleGeneration(props), {
                wrapper: Wrapper,
                initialProps: { conversationId: "conv_1", messages, isLoading: true, getModelIds: () => ["gpt-4o"] },
            })

            await act(async () => {
                rerender({ conversationId: "conv_1", messages, isLoading: false, getModelIds: () => ["gpt-4o"] })
                await flushAsync()
            })

            expect(generateTitleMock).not.toHaveBeenCalled()
        })

        it("does not fire when the assistant reply is a string of 10 chars or fewer", async () => {
            useGetMock.mockReturnValue({ data: { default_summary_model: "", default_model: "" } })
            const { Wrapper } = createQueryWrapper()
            const messages: Message[] = [
                msg("u1", "user", "A question that needs a real answer please."),
                msg("a1", "assistant", "Short"),
            ]

            const { rerender } = renderHook((props: Props) => useTitleGeneration(props), {
                wrapper: Wrapper,
                initialProps: { conversationId: "conv_1", messages, isLoading: true, getModelIds: () => ["gpt-4o"] },
            })

            await act(async () => {
                rerender({ conversationId: "conv_1", messages, isLoading: false, getModelIds: () => ["gpt-4o"] })
                await flushAsync()
            })

            expect(generateTitleMock).not.toHaveBeenCalled()
        })
    })

    // =========================================================================
    // Silent .catch around the PATCH — sidebar invalidation still happens
    // =========================================================================
    describe("PATCH failure handling", () => {
        it("still invalidates conversations even when conversations.updateTitle rejects, silently", async () => {
            useGetMock.mockReturnValue({ data: { default_summary_model: "", default_model: "" } })
            generateTitleMock.mockResolvedValue("Generated Title")
            updateTitleMock.mockRejectedValue(new Error("PATCH failed"))
            const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined)
            const { Wrapper } = createQueryWrapper()
            const messages: Message[] = [
                msg("u1", "user", "A question that needs a real answer please."),
                msg("a1", "assistant", "This is a fairly long assistant reply for testing."),
            ]

            const { rerender } = renderHook((props: Props) => useTitleGeneration(props), {
                wrapper: Wrapper,
                initialProps: { conversationId: "conv_1", messages, isLoading: true, getModelIds: () => ["gpt-4o"] },
            })

            await act(async () => {
                rerender({ conversationId: "conv_1", messages, isLoading: false, getModelIds: () => ["gpt-4o"] })
                await flushAsync()
                await flushAsync()
            })

            expect(updateTitleMock).toHaveBeenCalled()
            expect(invalidateConversationsMock).toHaveBeenCalledTimes(1)
            // The PATCH failure is swallowed silently — not logged like a
            // generateTitle failure would be.
            expect(consoleErrorSpy).not.toHaveBeenCalled()
            consoleErrorSpy.mockRestore()
        })

        it("logs via console.error and skips the PATCH entirely when gateway.generateTitle itself rejects", async () => {
            useGetMock.mockReturnValue({ data: { default_summary_model: "", default_model: "" } })
            generateTitleMock.mockRejectedValue(new Error("network fail"))
            const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined)
            const { Wrapper } = createQueryWrapper()
            const messages: Message[] = [
                msg("u1", "user", "A question that needs a real answer please."),
                msg("a1", "assistant", "This is a fairly long assistant reply for testing."),
            ]

            const { rerender } = renderHook((props: Props) => useTitleGeneration(props), {
                wrapper: Wrapper,
                initialProps: { conversationId: "conv_1", messages, isLoading: true, getModelIds: () => ["gpt-4o"] },
            })

            await act(async () => {
                rerender({ conversationId: "conv_1", messages, isLoading: false, getModelIds: () => ["gpt-4o"] })
                await flushAsync()
                await flushAsync()
            })

            expect(updateTitleMock).not.toHaveBeenCalled()
            expect(invalidateConversationsMock).not.toHaveBeenCalled()
            expect(consoleErrorSpy).toHaveBeenCalledWith("Failed to generate title:", expect.any(Error))
            consoleErrorSpy.mockRestore()
        })
    })

    // =========================================================================
    // Observed (documented, not asserted-as-bug) behavior: a failed
    // summary-model resolution still marks the conversation as "generated",
    // so it will not be retried on a later cycle even once a model becomes
    // available. This mirrors the code's own generatedRef.add() ordering
    // (line 77) which runs BEFORE the `if (!summaryModel) return` bail-out
    // (line 79).
    // =========================================================================
    it("does not retry generation on a later cycle after an earlier no-summary-model bail-out, even once a model becomes available", async () => {
        useGetMock.mockReturnValue({ data: { default_summary_model: "", default_model: "" } })
        const { Wrapper } = createQueryWrapper()
        const messages: Message[] = [
            msg("u1", "user", "A question that needs a real answer please."),
            msg("a1", "assistant", "This is a fairly long assistant reply for testing."),
        ]

        const { rerender } = renderHook((props: Props) => useTitleGeneration(props), {
            wrapper: Wrapper,
            initialProps: { conversationId: "conv_1", messages, isLoading: true, getModelIds: (): string[] => [] },
        })

        await act(async () => {
            rerender({ conversationId: "conv_1", messages, isLoading: false, getModelIds: () => [] })
            await flushAsync()
        })
        expect(generateTitleMock).not.toHaveBeenCalled()

        // A model becomes available and another loading cycle runs...
        await act(async () => {
            rerender({ conversationId: "conv_1", messages, isLoading: true, getModelIds: () => ["gpt-4o"] })
            await flushAsync()
        })
        await act(async () => {
            rerender({ conversationId: "conv_1", messages, isLoading: false, getModelIds: () => ["gpt-4o"] })
            await flushAsync()
        })

        // ...but the conversation was already marked "generated" on the first
        // (bailed-out) pass, so it's still never called.
        expect(generateTitleMock).not.toHaveBeenCalled()
    })
})
