import { act, renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { useSiblingNavigation } from "@/components/playground/hooks/use-sibling-navigation"

describe("useSiblingNavigation", () => {
    it("starts with an empty selectedSiblings map", () => {
        const { result } = renderHook(() => useSiblingNavigation())
        expect(result.current.selectedSiblings).toEqual(new Map())
        expect(result.current.selectedSiblings.size).toBe(0)
    })

    it("getSelectedIndex returns the provided default when the parent has no selection", () => {
        const { result } = renderHook(() => useSiblingNavigation())
        expect(result.current.getSelectedIndex("parent_1", 3)).toBe(3)
    })

    it("onSelectSibling records an index for a parent, retrievable via getSelectedIndex", () => {
        const { result } = renderHook(() => useSiblingNavigation())

        act(() => {
            result.current.onSelectSibling("parent_1", 2)
        })

        expect(result.current.selectedSiblings.get("parent_1")).toBe(2)
        expect(result.current.getSelectedIndex("parent_1", 0)).toBe(2)
    })

    it("tracks multiple parents independently", () => {
        const { result } = renderHook(() => useSiblingNavigation())

        act(() => {
            result.current.onSelectSibling("parent_1", 1)
        })
        act(() => {
            result.current.onSelectSibling("parent_2", 4)
        })

        expect(result.current.getSelectedIndex("parent_1", 0)).toBe(1)
        expect(result.current.getSelectedIndex("parent_2", 0)).toBe(4)
        expect(result.current.selectedSiblings.size).toBe(2)
    })

    it("overwrites a previous selection for the same parent", () => {
        const { result } = renderHook(() => useSiblingNavigation())

        act(() => {
            result.current.onSelectSibling("parent_1", 1)
        })
        act(() => {
            result.current.onSelectSibling("parent_1", 5)
        })

        expect(result.current.getSelectedIndex("parent_1", 0)).toBe(5)
        expect(result.current.selectedSiblings.size).toBe(1)
    })

    it("returns a new Map instance on each update (immutable state)", () => {
        const { result } = renderHook(() => useSiblingNavigation())
        const before = result.current.selectedSiblings

        act(() => {
            result.current.onSelectSibling("parent_1", 1)
        })

        const after = result.current.selectedSiblings
        expect(after).not.toBe(before)
    })

    it("a selected index of 0 is distinguishable from 'no selection' (falsy-but-valid value)", () => {
        const { result } = renderHook(() => useSiblingNavigation())

        act(() => {
            result.current.onSelectSibling("parent_1", 0)
        })

        // Must read back 0, not fall through to the default via `??`/`||` bugs.
        expect(result.current.getSelectedIndex("parent_1", 9)).toBe(0)
    })
})
