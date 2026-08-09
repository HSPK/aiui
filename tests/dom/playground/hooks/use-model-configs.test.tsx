import { act, cleanup, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { resetPlaygroundStore } from "../_render"
import { useModelConfigs } from "@/components/playground/hooks/use-model-configs"
import { usePlaygroundStore } from "@/lib/stores/playground-store"

afterEach(() => {
    // See use-chat-config.test.tsx for why cleanup() must run before
    // resetPlaygroundStore() mutates the shared store.
    cleanup()
    resetPlaygroundStore()
})

describe("useModelConfigs", () => {
    it("starts with empty modelConfigs for a fresh conversation", () => {
        const { result } = renderHook(() => useModelConfigs("conv_1"))
        expect(result.current.modelConfigs).toEqual({})
    })

    it("getModelConfig returns an empty object for a model with no stored config", () => {
        const { result } = renderHook(() => useModelConfigs("conv_1"))
        expect(result.current.getModelConfig("gpt-4o")).toEqual({})
    })

    it("updateModelConfig stores a config and is reflected in modelConfigs reactively", () => {
        const { result } = renderHook(() => useModelConfigs("conv_1"))

        act(() => {
            result.current.updateModelConfig("gpt-4o", { temperature: 0.5 })
        })

        expect(result.current.modelConfigs).toEqual({ "gpt-4o": { temperature: 0.5 } })
        expect(result.current.getModelConfig("gpt-4o")).toEqual({ temperature: 0.5 })
    })

    it("updateModelConfig preserves configs for other models", () => {
        const { result } = renderHook(() => useModelConfigs("conv_1"))

        act(() => {
            result.current.updateModelConfig("gpt-4o", { temperature: 0.5 })
        })
        act(() => {
            result.current.updateModelConfig("claude-3", { temperature: 0.9 })
        })

        expect(result.current.modelConfigs).toEqual({
            "gpt-4o": { temperature: 0.5 },
            "claude-3": { temperature: 0.9 },
        })
    })

    it("removeModelConfig deletes only the targeted model's config", () => {
        const { result } = renderHook(() => useModelConfigs("conv_1"))

        act(() => {
            result.current.updateModelConfig("gpt-4o", { temperature: 0.5 })
            result.current.updateModelConfig("claude-3", { temperature: 0.9 })
        })
        act(() => {
            result.current.removeModelConfig("gpt-4o")
        })

        expect(result.current.modelConfigs).toEqual({ "claude-3": { temperature: 0.9 } })
    })

    it("does not leak modelConfigs between different conversationIds", () => {
        const { result: convA } = renderHook(() => useModelConfigs("conv_a"))
        act(() => {
            convA.current.updateModelConfig("gpt-4o", { temperature: 0.5 })
        })

        const { result: convB } = renderHook(() => useModelConfigs("conv_b"))
        expect(convB.current.modelConfigs).toEqual({})
    })

    describe("buildConfigForModel", () => {
        it("always includes stream: true even with no other config", () => {
            const { result } = renderHook(() => useModelConfigs("conv_1"))
            expect(result.current.buildConfigForModel("gpt-4o")).toEqual({ stream: true })
        })

        it("includes history_limit only when globalHistoryLimit is explicitly provided", () => {
            const { result } = renderHook(() => useModelConfigs("conv_1"))
            expect(result.current.buildConfigForModel("gpt-4o", undefined)).toEqual({ stream: true })
            expect(result.current.buildConfigForModel("gpt-4o", 10)).toEqual({ stream: true, history_limit: 10 })
        })

        it("includes history_limit of 0 (a legit override, not treated as absent)", () => {
            const { result } = renderHook(() => useModelConfigs("conv_1"))
            expect(result.current.buildConfigForModel("gpt-4o", 0)).toEqual({ stream: true, history_limit: 0 })
        })

        it("includes system only when the trimmed prompt is non-empty", () => {
            const { result } = renderHook(() => useModelConfigs("conv_1"))
            expect(result.current.buildConfigForModel("gpt-4o", undefined, "  ")).toEqual({ stream: true })
            expect(result.current.buildConfigForModel("gpt-4o", undefined, "")).toEqual({ stream: true })
            expect(result.current.buildConfigForModel("gpt-4o", undefined, "  Be nice  ")).toEqual({
                stream: true,
                system: "Be nice",
            })
        })

        it("forwards temperature/maxTokens/topP/frequencyPenalty/presencePenalty only when defined, including falsy 0", () => {
            const { result } = renderHook(() => useModelConfigs("conv_1"))
            act(() => {
                result.current.updateModelConfig("gpt-4o", {
                    temperature: 0,
                    maxTokens: 256,
                    topP: 0.5,
                    frequencyPenalty: 0,
                    presencePenalty: 1.2,
                })
            })

            expect(result.current.buildConfigForModel("gpt-4o")).toEqual({
                stream: true,
                temperature: 0,
                max_tokens: 256,
                top_p: 0.5,
                frequency_penalty: 0,
                presence_penalty: 1.2,
            })
        })

        it("includes reasoning_effort only when set on the model config", () => {
            const { result } = renderHook(() => useModelConfigs("conv_1"))
            expect(result.current.buildConfigForModel("gpt-4o")).toEqual({ stream: true })

            act(() => {
                result.current.updateModelConfig("gpt-4o", { reasoningEffort: "high" })
            })
            expect(result.current.buildConfigForModel("gpt-4o")).toEqual({ stream: true, reasoning_effort: "high" })
        })

        it("builds independent configs per model in the same conversation", () => {
            const { result } = renderHook(() => useModelConfigs("conv_1"))
            act(() => {
                result.current.updateModelConfig("gpt-4o", { temperature: 0.2 })
                result.current.updateModelConfig("claude-3", { temperature: 0.8 })
            })

            expect(result.current.buildConfigForModel("gpt-4o", 5, "sys")).toEqual({
                stream: true,
                history_limit: 5,
                system: "sys",
                temperature: 0.2,
            })
            expect(result.current.buildConfigForModel("claude-3", 5, "sys")).toEqual({
                stream: true,
                history_limit: 5,
                system: "sys",
                temperature: 0.8,
            })
        })
    })

    it("reflects modelConfigs set directly on the underlying store (external mutation)", () => {
        const { result, rerender } = renderHook(() => useModelConfigs("conv_1"))

        act(() => {
            usePlaygroundStore.getState().updateSettings("conv_1", {
                modelConfigs: { "gpt-4o": { temperature: 0.33 } },
            })
        })
        rerender()

        expect(result.current.modelConfigs).toEqual({ "gpt-4o": { temperature: 0.33 } })
    })
})
