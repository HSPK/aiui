import { renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { useContextAssistant } from "@/components/playground/hooks/use-context-assistant"
import type { Message } from "@/components/playground/chat/types"

function msg(overrides: Partial<Message> & Pick<Message, "id" | "role">): Message {
    return { content: "", ...overrides }
}

describe("useContextAssistant", () => {
    it("returns undefined for an empty message list", () => {
        const { result } = renderHook(() => useContextAssistant([], new Map()))
        expect(result.current.contextAssistantId).toBeUndefined()
    })

    it("falls back to the last assistant message (by array order) when there is no user message at all", () => {
        const messages: Message[] = [
            msg({ id: "a1", role: "assistant" }),
            msg({ id: "a2", role: "assistant" }),
        ]
        const { result } = renderHook(() => useContextAssistant(messages, new Map()))
        expect(result.current.contextAssistantId).toBe("a2")
    })

    it("returns undefined when there is no user message and no assistant message either", () => {
        const messages: Message[] = [msg({ id: "s1", role: "system" })]
        const { result } = renderHook(() => useContextAssistant(messages, new Map()))
        expect(result.current.contextAssistantId).toBeUndefined()
    })

    it("falls back to the last assistant in the whole list when the last user message has no siblings", () => {
        const messages: Message[] = [
            msg({ id: "a0", role: "assistant" }),
            msg({ id: "u1", role: "user" }),
            // No assistant with parent_id === "u1"
        ]
        const { result } = renderHook(() => useContextAssistant(messages, new Map()))
        expect(result.current.contextAssistantId).toBe("a0")
    })

    it("defaults to the last sibling (sorted by created_at) when there is no selection and no usedAsParent match", () => {
        const messages: Message[] = [
            msg({ id: "u1", role: "user" }),
            msg({ id: "a1", role: "assistant", parent_id: "u1", created_at: "2024-01-01T00:00:02Z" }),
            msg({ id: "a2", role: "assistant", parent_id: "u1", created_at: "2024-01-01T00:00:01Z" }),
        ]
        const { result } = renderHook(() => useContextAssistant(messages, new Map()))
        // a2 is earlier than a1 despite array order, so sorted-last is a1.
        expect(result.current.contextAssistantId).toBe("a1")
    })

    it("sorts siblings by created_at ascending before applying priority rules", () => {
        const messages: Message[] = [
            msg({ id: "u1", role: "user" }),
            msg({ id: "a-early", role: "assistant", parent_id: "u1", created_at: "2024-01-01T00:00:00Z" }),
            msg({ id: "a-late", role: "assistant", parent_id: "u1", created_at: "2024-01-02T00:00:00Z" }),
            msg({ id: "a-mid", role: "assistant", parent_id: "u1", created_at: "2024-01-01T12:00:00Z" }),
        ]
        const { result } = renderHook(() => useContextAssistant(messages, new Map()))
        expect(result.current.contextAssistantId).toBe("a-late")
    })

    it("falls back to createdAt (camelCase) when created_at is absent", () => {
        const messages: Message[] = [
            msg({ id: "u1", role: "user" }),
            msg({ id: "a1", role: "assistant", parent_id: "u1", createdAt: "2024-01-01T00:00:02Z" }),
            msg({ id: "a2", role: "assistant", parent_id: "u1", createdAt: "2024-01-01T00:00:01Z" }),
        ]
        const { result } = renderHook(() => useContextAssistant(messages, new Map()))
        expect(result.current.contextAssistantId).toBe("a1")
    })

    it("treats missing created_at/createdAt as time 0 (sorts first)", () => {
        const messages: Message[] = [
            msg({ id: "u1", role: "user" }),
            msg({ id: "a-no-date", role: "assistant", parent_id: "u1" }),
            msg({ id: "a-dated", role: "assistant", parent_id: "u1", created_at: "2024-01-01T00:00:00Z" }),
        ]
        const { result } = renderHook(() => useContextAssistant(messages, new Map()))
        // a-no-date sorts to time 0, so a-dated (real timestamp) is last.
        expect(result.current.contextAssistantId).toBe("a-dated")
    })

    describe("priority 1 — user selection via selectedSiblings", () => {
        it("honors the selected index for the last user's siblings", () => {
            const messages: Message[] = [
                msg({ id: "u1", role: "user" }),
                msg({ id: "a1", role: "assistant", parent_id: "u1", created_at: "2024-01-01T00:00:01Z" }),
                msg({ id: "a2", role: "assistant", parent_id: "u1", created_at: "2024-01-01T00:00:02Z" }),
            ]
            const selected = new Map([["u1", 0]])
            const { result } = renderHook(() => useContextAssistant(messages, selected))
            expect(result.current.contextAssistantId).toBe("a1")
        })

        it("clamps an out-of-range selected index to the last sibling", () => {
            const messages: Message[] = [
                msg({ id: "u1", role: "user" }),
                msg({ id: "a1", role: "assistant", parent_id: "u1", created_at: "2024-01-01T00:00:01Z" }),
                msg({ id: "a2", role: "assistant", parent_id: "u1", created_at: "2024-01-01T00:00:02Z" }),
            ]
            const selected = new Map([["u1", 99]])
            const { result } = renderHook(() => useContextAssistant(messages, selected))
            expect(result.current.contextAssistantId).toBe("a2")
        })
    })

    describe("priority 2 — sibling used as parent by a subsequent message", () => {
        // NOTE: `lastUser` is found by scanning from the END of `messages` for
        // the last `role: "user"` entry. A "subsequent message continuing from
        // a sibling" must therefore NOT itself be `role: "user"`, or it would
        // become the new `lastUser` and change which siblings are considered
        // entirely. We use a `role: "tool"` message (e.g. a tool result feeding
        // back from an assistant's tool call) as a realistic non-user
        // continuation that still has a `parent_id` referencing a sibling.
        it("prefers the sibling that a later message continues from, over the default-last rule", () => {
            const messages: Message[] = [
                msg({ id: "u1", role: "user" }),
                msg({ id: "a1", role: "assistant", parent_id: "u1", created_at: "2024-01-01T00:00:01Z" }),
                msg({ id: "a2", role: "assistant", parent_id: "u1", created_at: "2024-01-01T00:00:02Z" }),
                // A tool result continues from a1 (e.g. a1 issued a tool call),
                // not the chronologically-last a2.
                msg({ id: "t1", role: "tool", parent_id: "a1" }),
            ]
            const { result } = renderHook(() => useContextAssistant(messages, new Map()))
            expect(result.current.contextAssistantId).toBe("a1")
        })

        it("returns the earliest (sorted-order) matching sibling when multiple siblings are used as parents", () => {
            const messages: Message[] = [
                msg({ id: "u1", role: "user" }),
                msg({ id: "a1", role: "assistant", parent_id: "u1", created_at: "2024-01-01T00:00:01Z" }),
                msg({ id: "a2", role: "assistant", parent_id: "u1", created_at: "2024-01-01T00:00:02Z" }),
                msg({ id: "t1", role: "tool", parent_id: "a1" }),
                msg({ id: "t2", role: "tool", parent_id: "a2" }),
            ]
            const { result } = renderHook(() => useContextAssistant(messages, new Map()))
            expect(result.current.contextAssistantId).toBe("a1")
        })

        it("takes priority over an explicit selectedSiblings choice only when no selection exists for this user", () => {
            // Sanity: priority 1 wins when BOTH a selection and a usedAsParent match exist.
            const messages: Message[] = [
                msg({ id: "u1", role: "user" }),
                msg({ id: "a1", role: "assistant", parent_id: "u1", created_at: "2024-01-01T00:00:01Z" }),
                msg({ id: "a2", role: "assistant", parent_id: "u1", created_at: "2024-01-01T00:00:02Z" }),
                msg({ id: "t1", role: "tool", parent_id: "a1" }),
            ]
            const selected = new Map([["u1", 1]]) // explicitly picks a2 (index 1 after sort)
            const { result } = renderHook(() => useContextAssistant(messages, selected))
            expect(result.current.contextAssistantId).toBe("a2")
        })
    })

    it("recomputes (memoizes off messages/selectedSiblings) when inputs change across a rerender", () => {
        const initialMessages: Message[] = [
            msg({ id: "u1", role: "user" }),
            msg({ id: "a1", role: "assistant", parent_id: "u1", created_at: "2024-01-01T00:00:01Z" }),
        ]
        const { result, rerender } = renderHook(
            ({ messages, selected }: { messages: Message[]; selected: Map<string, number> }) =>
                useContextAssistant(messages, selected),
            { initialProps: { messages: initialMessages, selected: new Map() } }
        )
        expect(result.current.contextAssistantId).toBe("a1")

        const nextMessages: Message[] = [
            ...initialMessages,
            msg({ id: "a2", role: "assistant", parent_id: "u1", created_at: "2024-01-01T00:00:02Z" }),
        ]
        rerender({ messages: nextMessages, selected: new Map() })
        expect(result.current.contextAssistantId).toBe("a2")
    })

    it("keeps contextAssistantIdRef.current in sync with the returned contextAssistantId", () => {
        const messages: Message[] = [
            msg({ id: "u1", role: "user" }),
            msg({ id: "a1", role: "assistant", parent_id: "u1" }),
        ]
        const { result, rerender } = renderHook(
            ({ messages }: { messages: Message[] }) => useContextAssistant(messages, new Map()),
            { initialProps: { messages } }
        )
        expect(result.current.contextAssistantIdRef.current).toBe("a1")

        const nextMessages: Message[] = [
            ...messages,
            msg({ id: "u2", role: "user" }),
            msg({ id: "a2", role: "assistant", parent_id: "u2" }),
        ]
        rerender({ messages: nextMessages })
        expect(result.current.contextAssistantId).toBe("a2")
        expect(result.current.contextAssistantIdRef.current).toBe("a2")
    })
})
