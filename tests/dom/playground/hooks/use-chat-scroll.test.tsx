import * as React from "react"
import { act, fireEvent, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useChatScroll } from "@/components/playground/hooks/use-chat-scroll"

type ScrollGeometry = { scrollHeight?: number; clientHeight?: number; scrollTop?: number }

/** jsdom doesn't lay out content, so scrollHeight/clientHeight/scrollTop
 *  all read 0 by default. scrollTop is backed by a real accessor pair so
 *  writes performed by the hook are observable on read-back, independent
 *  of jsdom's own (degenerate) scroll implementation. */
function mockScrollGeometry(el: HTMLDivElement, { scrollHeight = 0, clientHeight = 0, scrollTop = 0 }: ScrollGeometry) {
    let top = scrollTop
    Object.defineProperty(el, "scrollHeight", { value: scrollHeight, configurable: true })
    Object.defineProperty(el, "clientHeight", { value: clientHeight, configurable: true })
    Object.defineProperty(el, "scrollTop", {
        configurable: true,
        get: () => top,
        set: (v: number) => { top = v },
    })
}

type Options = Parameters<typeof useChatScroll>[0]

function Harness({
    options,
    onApi,
    initialGeometry,
}: {
    options: Options
    onApi: (api: ReturnType<typeof useChatScroll>) => void
    /** Seeded onto the DOM node via ref callback, BEFORE any of the hook's
     *  mount effects run (layout effects fire right after the ref attaches,
     *  in the same commit) — lets a test reproduce a true "mount already has
     *  non-trivial scroll geometry" scenario instead of only being able to
     *  observe effects starting from the first post-mount rerender. */
    initialGeometry?: ScrollGeometry
}) {
    const api = useChatScroll(options)
    onApi(api)
    const refCallback = (el: HTMLDivElement | null) => {
        api.viewportRef.current = el
        if (el && initialGeometry) mockScrollGeometry(el, initialGeometry)
    }
    return <div data-testid="viewport" ref={refCallback} onScroll={api.handleScroll} />
}

function renderHarness(options: Options, initialGeometry?: ScrollGeometry) {
    let api!: ReturnType<typeof useChatScroll>
    const utils = render(<Harness options={options} onApi={(a) => { api = a }} initialGeometry={initialGeometry} />)
    const viewport = utils.getByTestId("viewport") as HTMLDivElement
    viewport.scrollTo = vi.fn()
    return {
        ...utils,
        viewport,
        getApi: () => api,
        rerenderWith: (next: Options) => utils.rerender(<Harness options={next} onApi={(a) => { api = a }} />),
    }
}

describe("useChatScroll", () => {
    afterEach(() => {
        vi.useRealTimers()
    })

    it("returns showScrollBottom=false initially", () => {
        const { getApi } = renderHarness({ messages: [] })
        expect(getApi().showScrollBottom).toBe(false)
    })

    describe("mount behavior", () => {
        it("does not touch scrollTop on mount when there are no messages and no savedScrollPosition", () => {
            const { viewport } = renderHarness({ messages: [] })
            mockScrollGeometry(viewport, { scrollHeight: 1000, clientHeight: 400, scrollTop: 0 })
            expect(viewport.scrollTop).toBe(0)
        })

        it("jumps straight to the bottom (no smooth) once messages first appear", () => {
            const { viewport, rerenderWith } = renderHarness({ messages: [] })
            mockScrollGeometry(viewport, { scrollHeight: 1000, clientHeight: 400, scrollTop: 0 })

            rerenderWith({ messages: [{ id: "m1" }] })

            expect(viewport.scrollTop).toBe(1000)
            expect(viewport.scrollTo).not.toHaveBeenCalled()
        })

        it("restores a numeric savedScrollPosition on mount when there are no messages yet to trigger auto-scroll", () => {
            // Isolates the restore-on-mount layout effect: with messages
            // empty, the "smart auto-scroll" effect no-ops (it's guarded by
            // `messages.length === 0`), so this exercises the restore path
            // in isolation, uninterfered-with. See the BUG test below for
            // the realistic (messages already present) scenario.
            const { viewport } = renderHarness(
                { messages: [], savedScrollPosition: 250 },
                { scrollHeight: 1000, clientHeight: 400, scrollTop: 0 },
            )
            expect(viewport.scrollTop).toBe(250)
        })

        // =====================================================================
        // Regression test for a bug found while testing:
        // components/playground/hooks/use-chat-scroll.ts (`shouldAutoScrollRef`).
        // `shouldAutoScrollRef` used to be unconditionally initialized to
        // `true`, with no regard for whether a `savedScrollPosition` restore
        // is in play. Per chat-flow.tsx's own comment ("Restore the user's
        // scroll offset for this conversation if we have one — they bounced
        // to another modality and came back"), the realistic restore
        // scenario is a MOUNT where `messages` (from readCachedMessages) and
        // `savedScrollPosition` (from useModalityStore.getState(), a
        // synchronous snapshot read) are BOTH already available on the very
        // FIRST render — not a later transition.
        // In that mount, within the SAME commit:
        //   1. layout effect sees a numeric savedScrollPosition and sets
        //      viewport.scrollTop = 250 (correct, momentarily).
        //   2. passive effect "Initialize lastMessageIdRef" runs next
        //      (still null) and sets lastMessageIdRef.current to the last
        //      message's id.
        //   3. passive effect "Smart auto-scroll" runs last: isNewMessage =
        //      lastMsg.id !== lastMessageIdRef.current is FALSE (effect #2,
        //      just above it, already set that ref to the very same id) ->
        //      falls into `else if (shouldAutoScrollRef.current)`, which
        //      used to be unconditionally `true` -> ran
        //      `viewport.scrollTop = viewport.scrollHeight`, clobbering the
        //      value effect #1 just restored.
        // Fixed by initializing `shouldAutoScrollRef` to
        // `typeof savedScrollPosition !== 'number'` instead of an
        // unconditional `true`, so step 3 above only re-snaps to the
        // bottom when there was nothing to restore in the first place.
        // =====================================================================
        it(
            "restores a numeric savedScrollPosition on mount even when messages are already present, without it being clobbered back to the bottom",
            () => {
                const { viewport } = renderHarness(
                    { messages: [{ id: "m1" }], savedScrollPosition: 250 },
                    { scrollHeight: 1000, clientHeight: 400, scrollTop: 0 },
                )
                expect(viewport.scrollTop).toBe(250)
            },
        )

        it(
            "still scrolls to the bottom on mount when there is NO savedScrollPosition and messages are already present (fresh conversation)",
            () => {
                const { viewport } = renderHarness(
                    { messages: [{ id: "m1" }], savedScrollPosition: undefined },
                    { scrollHeight: 1000, clientHeight: 400, scrollTop: 0 },
                )
                expect(viewport.scrollTop).toBe(1000)
            },
        )
    })

    describe("smart auto-scroll on new messages", () => {
        it("smoothly scrolls to bottom when a brand-new last message id appears", () => {
            const { viewport, rerenderWith } = renderHarness({ messages: [{ id: "m1" }] })
            mockScrollGeometry(viewport, { scrollHeight: 500, clientHeight: 300, scrollTop: 0 })

            rerenderWith({ messages: [{ id: "m1" }, { id: "m2" }] })

            expect(viewport.scrollTo).toHaveBeenCalledWith({ top: 500, behavior: "smooth" })
        })

        it("keeps following (direct scrollTop set, no smooth) when the SAME last message streams more content and auto-scroll is still active", () => {
            const { viewport, rerenderWith } = renderHarness({ messages: [{ id: "m1" }] })
            mockScrollGeometry(viewport, { scrollHeight: 500, clientHeight: 300, scrollTop: 0 })

            // New message -> establishes shouldAutoScrollRef = true, lastMessageIdRef = "m2".
            rerenderWith({ messages: [{ id: "m1" }, { id: "m2" }] })
            ;(viewport.scrollTo as ReturnType<typeof vi.fn>).mockClear()

            // Grow the content height to simulate a streamed chunk landing on the same message.
            Object.defineProperty(viewport, "scrollHeight", { value: 900, configurable: true })
            viewport.scrollTop = 0

            rerenderWith({ messages: [{ id: "m1" }, { id: "m2", content: "more" }] })

            expect(viewport.scrollTop).toBe(900)
            expect(viewport.scrollTo).not.toHaveBeenCalled()
        })

        it("stops following (does not move scrollTop) once the user has scrolled away from the bottom", () => {
            const { viewport, rerenderWith } = renderHarness({ messages: [{ id: "m1" }] })
            mockScrollGeometry(viewport, { scrollHeight: 500, clientHeight: 300, scrollTop: 0 })

            rerenderWith({ messages: [{ id: "m1" }, { id: "m2" }] })

            // User scrolls up, far from bottom: scrollHeight(500) - scrollTop(50) - clientHeight(300) = 150 >= 100.
            act(() => {
                fireEvent.scroll(viewport, { target: { scrollTop: 50 } })
            })
            viewport.scrollTop = 50 // simulate the browser leaving the user's manual position

            rerenderWith({ messages: [{ id: "m1" }, { id: "m2", content: "more" }] })

            expect(viewport.scrollTop).toBe(50)
        })
    })

    describe("handleScroll", () => {
        it("shows the scroll-to-bottom button when far from the bottom", () => {
            const { viewport, getApi } = renderHarness({ messages: [{ id: "m1" }] })
            mockScrollGeometry(viewport, { scrollHeight: 1000, clientHeight: 300, scrollTop: 0 })

            act(() => {
                fireEvent.scroll(viewport, { target: { scrollTop: 100 } })
            })

            expect(getApi().showScrollBottom).toBe(true)
        })

        it("hides the scroll-to-bottom button again once the user scrolls back near the bottom", () => {
            const { viewport, getApi } = renderHarness({ messages: [{ id: "m1" }] })
            mockScrollGeometry(viewport, { scrollHeight: 1000, clientHeight: 300, scrollTop: 0 })

            // First move away from the bottom to flip the button on...
            act(() => {
                fireEvent.scroll(viewport, { target: { scrollTop: 100 } })
            })
            expect(getApi().showScrollBottom).toBe(true)

            // ...then scroll back within 100px of the bottom: 1000 - 650 - 300 = 50 < 100.
            act(() => {
                fireEvent.scroll(viewport, { target: { scrollTop: 650 } })
            })
            expect(getApi().showScrollBottom).toBe(false)
        })

        it("triggers onLoadMore when scrolled within 50px of the top, hasMore is true, and not already loading more", () => {
            const onLoadMore = vi.fn()
            const { viewport } = renderHarness({ messages: [{ id: "m1" }], hasMore: true, isLoadingMore: false, onLoadMore })
            mockScrollGeometry(viewport, { scrollHeight: 1000, clientHeight: 300, scrollTop: 40 })

            act(() => {
                fireEvent.scroll(viewport, { target: { scrollTop: 40 } })
            })

            expect(onLoadMore).toHaveBeenCalledTimes(1)
        })

        it("does not trigger onLoadMore when scrollTop is >= 50px from top", () => {
            const onLoadMore = vi.fn()
            const { viewport } = renderHarness({ messages: [{ id: "m1" }], hasMore: true, isLoadingMore: false, onLoadMore })
            mockScrollGeometry(viewport, { scrollHeight: 1000, clientHeight: 300, scrollTop: 200 })

            act(() => {
                fireEvent.scroll(viewport, { target: { scrollTop: 200 } })
            })

            expect(onLoadMore).not.toHaveBeenCalled()
        })

        it("does not trigger onLoadMore when hasMore is false", () => {
            const onLoadMore = vi.fn()
            const { viewport } = renderHarness({ messages: [{ id: "m1" }], hasMore: false, isLoadingMore: false, onLoadMore })
            mockScrollGeometry(viewport, { scrollHeight: 1000, clientHeight: 300, scrollTop: 10 })

            act(() => {
                fireEvent.scroll(viewport, { target: { scrollTop: 10 } })
            })

            expect(onLoadMore).not.toHaveBeenCalled()
        })

        it("does not trigger onLoadMore when isLoadingMore is already true", () => {
            const onLoadMore = vi.fn()
            const { viewport } = renderHarness({ messages: [{ id: "m1" }], hasMore: true, isLoadingMore: true, onLoadMore })
            mockScrollGeometry(viewport, { scrollHeight: 1000, clientHeight: 300, scrollTop: 10 })

            act(() => {
                fireEvent.scroll(viewport, { target: { scrollTop: 10 } })
            })

            expect(onLoadMore).not.toHaveBeenCalled()
        })

        it("does not trigger onLoadMore when there are no messages yet", () => {
            const onLoadMore = vi.fn()
            const { viewport } = renderHarness({ messages: [], hasMore: true, isLoadingMore: false, onLoadMore })
            mockScrollGeometry(viewport, { scrollHeight: 1000, clientHeight: 300, scrollTop: 10 })

            act(() => {
                fireEvent.scroll(viewport, { target: { scrollTop: 10 } })
            })

            expect(onLoadMore).not.toHaveBeenCalled()
        })
    })

    describe("scrollToBottom", () => {
        it("smoothly scrolls the viewport to its current scrollHeight", () => {
            const { viewport, getApi } = renderHarness({ messages: [] })
            mockScrollGeometry(viewport, { scrollHeight: 777, clientHeight: 300, scrollTop: 0 })

            act(() => {
                getApi().scrollToBottom()
            })

            expect(viewport.scrollTo).toHaveBeenCalledWith({ top: 777, behavior: "smooth" })
        })

        it("is a safe no-op when the viewport ref is not attached", () => {
            // useChatScroll called directly without ever mounting a ref'd node.
            let capturedApi: ReturnType<typeof useChatScroll> | null = null
            function Bare() {
                capturedApi = useChatScroll({ messages: [] })
                return null
            }
            render(<Bare />)
            expect(() => act(() => capturedApi!.scrollToBottom())).not.toThrow()
        })
    })

    describe("preserveScrollPosition", () => {
        beforeEach(() => {
            vi.useFakeTimers()
        })

        it("adjusts scrollTop by the height delta introduced by the callback, on the next animation frame", () => {
            const { viewport, getApi } = renderHarness({ messages: [] })
            mockScrollGeometry(viewport, { scrollHeight: 1000, clientHeight: 400, scrollTop: 200 })

            act(() => {
                getApi().preserveScrollPosition(() => {
                    // Simulate older messages being prepended, growing content height.
                    Object.defineProperty(viewport, "scrollHeight", { value: 1500, configurable: true })
                })
            })
            act(() => {
                vi.advanceTimersToNextFrame()
            })

            // heightDiff (500) + oldTop (200) = 700.
            expect(viewport.scrollTop).toBe(700)
        })

        it("invokes the callback synchronously, before the rAF-scheduled adjustment", () => {
            const { viewport, getApi } = renderHarness({ messages: [] })
            mockScrollGeometry(viewport, { scrollHeight: 1000, clientHeight: 400, scrollTop: 0 })
            const callback = vi.fn()

            act(() => {
                getApi().preserveScrollPosition(callback)
            })

            expect(callback).toHaveBeenCalledTimes(1)
        })
    })

    describe("unmount — saving scroll position", () => {
        it("calls onSaveScrollPosition with the last recorded scrollTop when it is > 0", () => {
            const onSaveScrollPosition = vi.fn()
            const { viewport, unmount } = renderHarness({ messages: [{ id: "m1" }], onSaveScrollPosition })
            mockScrollGeometry(viewport, { scrollHeight: 1000, clientHeight: 300, scrollTop: 0 })

            act(() => {
                fireEvent.scroll(viewport, { target: { scrollTop: 321 } })
            })

            unmount()

            expect(onSaveScrollPosition).toHaveBeenCalledWith(321)
        })

        it("does not call onSaveScrollPosition when the recorded scroll position is still 0", () => {
            const onSaveScrollPosition = vi.fn()
            const { unmount } = renderHarness({ messages: [{ id: "m1" }], onSaveScrollPosition })

            unmount()

            expect(onSaveScrollPosition).not.toHaveBeenCalled()
        })
    })
})
