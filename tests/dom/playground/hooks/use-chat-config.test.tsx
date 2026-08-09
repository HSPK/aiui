import { act, cleanup, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { resetPlaygroundStore } from "../_render"

const useGetMock = vi.hoisted(() => vi.fn())
vi.mock("@/lib/api/preferences", () => ({
    preferences: { useGet: useGetMock },
}))

 
import { useChatConfig } from "@/components/playground/hooks/use-chat-config"
 
import { usePlaygroundStore } from "@/lib/stores/playground-store"
 
import { defaultUserPreferences } from "@/lib/schemas/preferences"

afterEach(() => {
    // Unmount any still-mounted renderHook internals BEFORE mutating the
    // shared store / mocks below. The global setup afterEach also calls
    // cleanup(), but hook afterEach callbacks run before outer (setup-file)
    // ones, so without this explicit call, resetPlaygroundStore()'s setState
    // can synchronously re-render a stale, still-mounted hook instance
    // against an already-.mockReset() preferences.useGet(), crashing with
    // "Cannot destructure property 'data' of ... as it is undefined".
    cleanup()
    resetPlaygroundStore()
    useGetMock.mockReset()
})

describe("useChatConfig", () => {
    it("falls back to schema defaults when prefs haven't loaded and there is no conversation override", () => {
        useGetMock.mockReturnValue({ data: undefined })

        const { result } = renderHook(() => useChatConfig("conv_1"))

        expect(result.current).toEqual({
            historyLimit: defaultUserPreferences.default_history_limit,
            systemPrompt: defaultUserPreferences.default_system_prompt,
            singleModelMode: false,
        })
    })

    it("uses fetched account preferences over hard-coded schema defaults", () => {
        useGetMock.mockReturnValue({
            data: { ...defaultUserPreferences, default_history_limit: 25, default_system_prompt: "Custom account prompt" },
        })

        const { result } = renderHook(() => useChatConfig("conv_1"))

        expect(result.current.historyLimit).toBe(25)
        expect(result.current.systemPrompt).toBe("Custom account prompt")
        expect(result.current.singleModelMode).toBe(false)
    })

    it("conversation-level settings override account preferences", () => {
        useGetMock.mockReturnValue({
            data: { ...defaultUserPreferences, default_history_limit: 25, default_system_prompt: "Account prompt" },
        })
        act(() => {
            usePlaygroundStore.getState().updateSettings("conv_1", {
                historyLimit: 5,
                systemPrompt: "Conversation-specific prompt",
                singleModelMode: true,
            })
        })

        const { result } = renderHook(() => useChatConfig("conv_1"))

        expect(result.current).toEqual({
            historyLimit: 5,
            systemPrompt: "Conversation-specific prompt",
            singleModelMode: true,
        })
    })

    it("treats a conversation historyLimit of 0 as a real override, not a fallthrough (?? semantics)", () => {
        useGetMock.mockReturnValue({ data: undefined })
        act(() => {
            usePlaygroundStore.getState().updateSettings("conv_1", { historyLimit: 0 })
        })

        const { result } = renderHook(() => useChatConfig("conv_1"))
        expect(result.current.historyLimit).toBe(0)
    })

    it("treats an empty-string conversation systemPrompt as a real override, not a fallthrough", () => {
        useGetMock.mockReturnValue({ data: undefined })
        act(() => {
            usePlaygroundStore.getState().updateSettings("conv_1", { systemPrompt: "" })
        })

        const { result } = renderHook(() => useChatConfig("conv_1"))
        expect(result.current.systemPrompt).toBe("")
    })

    it("does not leak settings between different conversationIds", () => {
        useGetMock.mockReturnValue({ data: undefined })
        act(() => {
            usePlaygroundStore.getState().updateSettings("conv_1", { historyLimit: 5 })
        })

        const { result } = renderHook(() => useChatConfig("conv_2"))
        expect(result.current.historyLimit).toBe(defaultUserPreferences.default_history_limit)
    })

    it("reacts to store updates after mount (subscribes reactively)", () => {
        useGetMock.mockReturnValue({ data: undefined })
        const { result } = renderHook(() => useChatConfig("conv_1"))
        expect(result.current.historyLimit).toBe(defaultUserPreferences.default_history_limit)

        act(() => {
            usePlaygroundStore.getState().updateSettings("conv_1", { historyLimit: 42 })
        })

        expect(result.current.historyLimit).toBe(42)
    })

    it("singleModelMode defaults to false when unset even if other settings exist for the conversation", () => {
        useGetMock.mockReturnValue({ data: undefined })
        act(() => {
            usePlaygroundStore.getState().updateSettings("conv_1", { historyLimit: 7 })
        })

        const { result } = renderHook(() => useChatConfig("conv_1"))
        expect(result.current.singleModelMode).toBe(false)
    })
})
