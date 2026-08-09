import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { ConversationItem, ListSkeleton } from "@/components/playground/_parts/conversation-item"
import type { ConversationDTO } from "@/lib/schemas/conversation"

// Real next/link renders fine as an <a>, but its internal SPA routing
// depends on an app-router context we don't provide in this harness, and
// this component additionally attaches a `setTimeout` soft-nav fallback
// (`window.location.assign`) to its onClick. Simplifying to a plain <a>
// keeps interaction tests deterministic and avoids jsdom "not implemented:
// navigation" noise.
vi.mock("next/link", () => ({
    default: ({ href, children, prefetch: _prefetch, ...rest }: any) => (
        <a href={href} {...rest}>
            {children}
        </a>
    ),
}))

function makeConversation(overrides: Partial<ConversationDTO> = {}): ConversationDTO {
    return {
        id: "conv_1",
        user_id: "user_1",
        title: "My conversation",
        config: {},
        created_at: "2024-01-01T00:00:00.000Z",
        updated_at: "2024-01-01T00:00:00.000Z",
        is_deleted: false,
        ...overrides,
    }
}

// The row's onClick schedules a 300ms `window.location.assign` soft-nav
// fallback for real browsers whose router transition stalls. jsdom logs a
// harmless "Not implemented: navigation" notice if that ever fires (same
// as clicking any real <a href> in jsdom) — it doesn't throw or fail
// tests, so no special handling is needed here.
function setupUser() {
    return userEvent.setup()
}

afterEach(() => {
    cleanup()
})

describe("ConversationItem", () => {
    it("renders the conversation title and links to the given href", () => {
        render(
            <ConversationItem
                conv={makeConversation({ title: "Trip planning" })}
                isSelected={false}
                href="/playground/chat?c=conv_1"
                onDeleteRequest={vi.fn()}
                onRename={vi.fn()}
            />,
        )
        expect(screen.getByText("Trip planning")).toBeInTheDocument()
        expect(screen.getByRole("link")).toHaveAttribute("href", "/playground/chat?c=conv_1")
    })

    it("calls onPick when clicking a non-selected row", async () => {
        const user = setupUser()
        const onPick = vi.fn()
        render(
            <ConversationItem
                conv={makeConversation()}
                isSelected={false}
                href="/playground/chat?c=conv_1"
                onPick={onPick}
                onDeleteRequest={vi.fn()}
                onRename={vi.fn()}
            />,
        )
        await user.click(screen.getByRole("link"))
        expect(onPick).toHaveBeenCalledTimes(1)
        expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: "conv_1" }))
    })

    it("does NOT call onPick when clicking an already-selected row (click is short-circuited)", async () => {
        const user = setupUser()
        const onPick = vi.fn()
        render(
            <ConversationItem
                conv={makeConversation()}
                isSelected={true}
                href="/playground/chat?c=conv_1"
                onPick={onPick}
                onDeleteRequest={vi.fn()}
                onRename={vi.fn()}
            />,
        )
        await user.click(screen.getByRole("link"))
        expect(onPick).not.toHaveBeenCalled()
    })

    it("fires onHoverPrefetch on mouse-enter and on focus", async () => {
        const onHoverPrefetch = vi.fn()
        render(
            <ConversationItem
                conv={makeConversation()}
                isSelected={false}
                href="/playground/chat?c=conv_1"
                onHoverPrefetch={onHoverPrefetch}
                onDeleteRequest={vi.fn()}
                onRename={vi.fn()}
            />,
        )
        const link = screen.getByRole("link")
        const user = setupUser()
        await user.hover(link)
        expect(onHoverPrefetch).toHaveBeenCalledTimes(1)

        link.focus()
        expect(onHoverPrefetch).toHaveBeenCalledTimes(2)
    })

    it("opens the row menu and calls onDeleteRequest when Delete is clicked", async () => {
        const user = setupUser()
        const onDeleteRequest = vi.fn()
        const conv = makeConversation()
        render(
            <ConversationItem
                conv={conv}
                isSelected={false}
                href="/playground/chat?c=conv_1"
                onDeleteRequest={onDeleteRequest}
                onRename={vi.fn()}
            />,
        )
        await user.click(screen.getByRole("button"))
        await user.click(await screen.findByRole("menuitem", { name: /delete/i }))
        expect(onDeleteRequest).toHaveBeenCalledWith(conv)
    })

    it("clicking the row's menu trigger does not also trigger onPick (stopPropagation)", async () => {
        const user = setupUser()
        const onPick = vi.fn()
        render(
            <ConversationItem
                conv={makeConversation()}
                isSelected={false}
                href="/playground/chat?c=conv_1"
                onPick={onPick}
                onDeleteRequest={vi.fn()}
                onRename={vi.fn()}
            />,
        )
        await user.click(screen.getByRole("button"))
        expect(onPick).not.toHaveBeenCalled()
    })

    it("Rename switches to edit mode with the current title pre-filled and focused/selected", async () => {
        const user = setupUser()
        render(
            <ConversationItem
                conv={makeConversation({ title: "Old title" })}
                isSelected={false}
                href="/playground/chat?c=conv_1"
                onDeleteRequest={vi.fn()}
                onRename={vi.fn()}
            />,
        )
        await user.click(screen.getByRole("button"))
        await user.click(await screen.findByRole("menuitem", { name: /rename/i }))
        const input = screen.getByDisplayValue("Old title")
        expect(input).toHaveFocus()
    })

    it("saves a renamed title on Enter and calls onRename with the trimmed value", async () => {
        const user = setupUser()
        const onRename = vi.fn()
        const conv = makeConversation({ title: "Old title" })
        render(
            <ConversationItem
                conv={conv}
                isSelected={false}
                href="/playground/chat?c=conv_1"
                onDeleteRequest={vi.fn()}
                onRename={onRename}
            />,
        )
        await user.click(screen.getByRole("button"))
        await user.click(await screen.findByRole("menuitem", { name: /rename/i }))
        const input = screen.getByDisplayValue("Old title")
        await user.clear(input)
        await user.type(input, "  New title  {Enter}")
        expect(onRename).toHaveBeenCalledWith(conv, "New title")
        // Back to display mode.
        expect(screen.getByRole("link")).toBeInTheDocument()
    })

    it("saves via the inline check button", async () => {
        const user = setupUser()
        const onRename = vi.fn()
        const conv = makeConversation({ title: "Old title" })
        render(
            <ConversationItem
                conv={conv}
                isSelected={false}
                href="/playground/chat?c=conv_1"
                onDeleteRequest={vi.fn()}
                onRename={onRename}
            />,
        )
        await user.click(screen.getByRole("button"))
        await user.click(await screen.findByRole("menuitem", { name: /rename/i }))
        const input = screen.getByDisplayValue("Old title")
        await user.clear(input)
        await user.type(input, "New title")
        // The check ("save") button has no accessible name beyond its icon;
        // it's the first of the two icon buttons rendered next to the input.
        const buttons = screen.getAllByRole("button")
        await user.click(buttons[0])
        expect(onRename).toHaveBeenCalledWith(conv, "New title")
    })

    it("does not call onRename when the title is unchanged", async () => {
        const user = setupUser()
        const onRename = vi.fn()
        render(
            <ConversationItem
                conv={makeConversation({ title: "Same title" })}
                isSelected={false}
                href="/playground/chat?c=conv_1"
                onDeleteRequest={vi.fn()}
                onRename={onRename}
            />,
        )
        await user.click(screen.getByRole("button"))
        await user.click(await screen.findByRole("menuitem", { name: /rename/i }))
        await user.keyboard("{Enter}")
        expect(onRename).not.toHaveBeenCalled()
    })

    it("does not call onRename when the trimmed title is empty", async () => {
        const user = setupUser()
        const onRename = vi.fn()
        render(
            <ConversationItem
                conv={makeConversation({ title: "Old title" })}
                isSelected={false}
                href="/playground/chat?c=conv_1"
                onDeleteRequest={vi.fn()}
                onRename={onRename}
            />,
        )
        await user.click(screen.getByRole("button"))
        await user.click(await screen.findByRole("menuitem", { name: /rename/i }))
        const input = screen.getByDisplayValue("Old title")
        await user.clear(input)
        await user.type(input, "   {Enter}")
        expect(onRename).not.toHaveBeenCalled()
        expect(screen.getByText("Old title")).toBeInTheDocument()
    })

    it("Escape cancels editing without calling onRename and restores the display row", async () => {
        const user = setupUser()
        const onRename = vi.fn()
        render(
            <ConversationItem
                conv={makeConversation({ title: "Old title" })}
                isSelected={false}
                href="/playground/chat?c=conv_1"
                onDeleteRequest={vi.fn()}
                onRename={onRename}
            />,
        )
        await user.click(screen.getByRole("button"))
        await user.click(await screen.findByRole("menuitem", { name: /rename/i }))
        const input = screen.getByDisplayValue("Old title")
        await user.clear(input)
        await user.type(input, "Something else")
        await user.keyboard("{Escape}")
        expect(onRename).not.toHaveBeenCalled()
        expect(screen.getByRole("link")).toBeInTheDocument()
        expect(screen.getByText("Old title")).toBeInTheDocument()
    })

    // BUG (components/playground/_parts/conversation-item.tsx:116,127): the
    // input's `onBlur={handleSaveEdit}` fires before the Cancel button's own
    // `onClick`, because clicking any other element blurs the previously
    // focused input first. Since `handleSaveEdit` unconditionally saves any
    // non-empty, changed title regardless of which element is about to be
    // clicked, clicking "Cancel" after typing a new title actually SAVES it
    // instead of discarding it — the Cancel button only behaves correctly
    // when the draft is empty or unchanged. Users who type a new title, then
    // change their mind and click the X, get a silent unwanted rename.
    // Fixed: the Cancel button now uses onMouseDown + preventDefault so the
    // input never blurs, and the save-on-blur path can't fire first.
    it("cancels via the inline X button, restoring the original title without saving", async () => {
        const user = setupUser()
        const onRename = vi.fn()
        const conv = makeConversation({ title: "Old title" })
        render(
            <ConversationItem
                conv={conv}
                isSelected={false}
                href="/playground/chat?c=conv_1"
                onDeleteRequest={vi.fn()}
                onRename={onRename}
            />,
        )
        await user.click(screen.getByRole("button"))
        await user.click(await screen.findByRole("menuitem", { name: /rename/i }))
        const input = screen.getByDisplayValue("Old title")
        await user.clear(input)
        await user.type(input, "Discarded title")
        // The X ("cancel") button is the second of the two icon buttons
        // rendered next to the input while editing.
        const buttons = screen.getAllByRole("button")
        await user.click(buttons[1])
        expect(onRename).not.toHaveBeenCalled()
        expect(screen.getByText("Old title")).toBeInTheDocument()
        expect(screen.queryByDisplayValue("Discarded title")).not.toBeInTheDocument()
    })

    // The two tests below dispatch a bare "click" via `fireEvent` instead of
    // `userEvent`. `userEvent.click` simulates the full realistic pointer
    // sequence (which blurs the previously-focused input *before* the click
    // reaches its target — see the bug documented above), so it can never
    // actually exercise these buttons' own `onClick` bodies in isolation.
    // `fireEvent.click` dispatches only the "click" event, letting these
    // handlers run directly and proving they are independently correct — the
    // bug above is specifically about interaction ordering with blur, not
    // faulty handler logic.
    it("the check button's own onClick handler saves the new title directly", async () => {
        const user = setupUser()
        const onRename = vi.fn()
        const conv = makeConversation({ title: "Old title" })
        render(
            <ConversationItem
                conv={conv}
                isSelected={false}
                href="/playground/chat?c=conv_1"
                onDeleteRequest={vi.fn()}
                onRename={onRename}
            />,
        )
        await user.click(screen.getByRole("button"))
        await user.click(await screen.findByRole("menuitem", { name: /rename/i }))
        const input = screen.getByDisplayValue("Old title") as HTMLInputElement
        // `fireEvent.change` (unlike `userEvent.type`) doesn't move focus, so
        // the input stays focused going into the `fireEvent.click` below —
        // that click is what must NOT trigger a preceding blur.
        fireEvent.change(input, { target: { value: "New title" } })
        const buttons = screen.getAllByRole("button")
        fireEvent.click(buttons[0])
        expect(onRename).toHaveBeenCalledWith(conv, "New title")
    })

    it("the X button's own onClick handler cancels directly, without saving", async () => {
        const user = setupUser()
        const onRename = vi.fn()
        const conv = makeConversation({ title: "Old title" })
        render(
            <ConversationItem
                conv={conv}
                isSelected={false}
                href="/playground/chat?c=conv_1"
                onDeleteRequest={vi.fn()}
                onRename={onRename}
            />,
        )
        await user.click(screen.getByRole("button"))
        await user.click(await screen.findByRole("menuitem", { name: /rename/i }))
        const input = screen.getByDisplayValue("Old title") as HTMLInputElement
        fireEvent.change(input, { target: { value: "Discarded title" } })
        const buttons = screen.getAllByRole("button")
        // Real pointer interaction: mousedown fires first, which is exactly
        // the ordering the fix depends on.
        fireEvent.mouseDown(buttons[1])
        fireEvent.click(buttons[1])
        expect(onRename).not.toHaveBeenCalled()
        expect(screen.getByText("Old title")).toBeInTheDocument()
        expect(screen.queryByDisplayValue("Discarded title")).not.toBeInTheDocument()
    })

    it("ignores Enter while an IME composition is in progress, but saves once composition ends", async () => {
        const user = setupUser()
        const onRename = vi.fn()
        const conv = makeConversation({ title: "Old title" })
        render(
            <ConversationItem
                conv={conv}
                isSelected={false}
                href="/playground/chat?c=conv_1"
                onDeleteRequest={vi.fn()}
                onRename={onRename}
            />,
        )
        await user.click(screen.getByRole("button"))
        await user.click(await screen.findByRole("menuitem", { name: /rename/i }))
        const input = screen.getByDisplayValue("Old title")
        await user.clear(input)
        await user.type(input, "Composed title")
        fireEvent.compositionStart(input)
        fireEvent.keyDown(input, { key: "Enter" })
        // Composition is still active: Enter must NOT have triggered a save.
        expect(onRename).not.toHaveBeenCalled()
        expect(screen.getByDisplayValue("Composed title")).toBeInTheDocument()
        fireEvent.compositionEnd(input)
        fireEvent.keyDown(input, { key: "Enter" })
        expect(onRename).toHaveBeenCalledWith(conv, "Composed title")
    })

    it("saves on blur", async () => {
        const user = setupUser()
        const onRename = vi.fn()
        const conv = makeConversation({ title: "Old title" })
        render(
            <>
                <ConversationItem
                    conv={conv}
                    isSelected={false}
                    href="/playground/chat?c=conv_1"
                    onDeleteRequest={vi.fn()}
                    onRename={onRename}
                />
                <button type="button">outside</button>
            </>,
        )
        const trigger = screen.getAllByRole("button").find((b) => b.textContent !== "outside")!
        await user.click(trigger)
        await user.click(await screen.findByRole("menuitem", { name: /rename/i }))
        const input = screen.getByDisplayValue("Old title")
        await user.clear(input)
        await user.type(input, "Blurred title")
        await user.click(screen.getByRole("button", { name: "outside" }))
        expect(onRename).toHaveBeenCalledWith(conv, "Blurred title")
    })

    it("uses compact styling by default and larger touch targets when compact=false", () => {
        const { rerender, container } = render(
            <ConversationItem
                conv={makeConversation()}
                isSelected={false}
                href="/playground/chat?c=conv_1"
                onDeleteRequest={vi.fn()}
                onRename={vi.fn()}
            />,
        )
        expect(container.querySelector("a")?.className).toContain("text-sm")

        rerender(
            <ConversationItem
                conv={makeConversation()}
                isSelected={false}
                href="/playground/chat?c=conv_1"
                onDeleteRequest={vi.fn()}
                onRename={vi.fn()}
                compact={false}
            />,
        )
        expect(container.querySelector("a")?.className).toContain("h-11")
        expect(container.querySelector("a")?.className).toContain("text-base")
    })

    describe("soft-nav fallback", () => {
        /** jsdom's `window.location` methods are non-configurable, so
         *  `vi.spyOn(window.location, "assign")` throws "Cannot redefine
         *  property". Swap the whole `location` object out instead. */
        function installLocationAssignSpy() {
            const assignMock = vi.fn()
            const original = window.location
            Object.defineProperty(window, "location", {
                configurable: true,
                value: { ...original, search: "", assign: assignMock },
            })
            return {
                assignMock,
                setSearch: (search: string) => {
                    Object.defineProperty(window, "location", {
                        configurable: true,
                        value: { ...window.location, search, assign: assignMock },
                    })
                },
                restore: () => {
                    Object.defineProperty(window, "location", { configurable: true, value: original })
                },
            }
        }

        beforeEach(() => {
            vi.useFakeTimers()
        })

        afterEach(() => {
            vi.useRealTimers()
        })

        it("falls back to a full-page navigation if the URL hasn't updated 300ms after the click", () => {
            const spy = installLocationAssignSpy()
            try {
                render(
                    <ConversationItem
                        conv={makeConversation({ id: "conv_1" })}
                        isSelected={false}
                        href="/playground/chat?c=conv_1"
                        onPick={vi.fn()}
                        onDeleteRequest={vi.fn()}
                        onRename={vi.fn()}
                    />,
                )
                fireEvent.click(screen.getByRole("link"))
                act(() => {
                    vi.advanceTimersByTime(300)
                })
                expect(spy.assignMock).toHaveBeenCalledWith("/playground/chat?c=conv_1")
            } finally {
                spy.restore()
            }
        })

        it("does NOT force-navigate if the URL already picked up the target id within 300ms (soft-nav worked)", () => {
            const spy = installLocationAssignSpy()
            try {
                render(
                    <ConversationItem
                        conv={makeConversation({ id: "conv_1" })}
                        isSelected={false}
                        href="/playground/chat?c=conv_1"
                        onPick={vi.fn()}
                        onDeleteRequest={vi.fn()}
                        onRename={vi.fn()}
                    />,
                )
                fireEvent.click(screen.getByRole("link"))
                // Simulate the router having already applied the soft
                // navigation before the 300ms fallback timer elapses.
                spy.setSearch("?c=conv_1")
                act(() => {
                    vi.advanceTimersByTime(300)
                })
                expect(spy.assignMock).not.toHaveBeenCalled()
            } finally {
                spy.restore()
            }
        })
    })
})

describe("ListSkeleton", () => {
    it("renders one heading skeleton plus 6 row skeletons", () => {
        const { container } = render(<ListSkeleton />)
        expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(7)
    })
})
