import { describe, it, expect } from "vitest"

import { CAPABILITY_HEURISTIC, matchesCapability } from "@/components/playground/modality-filters"
import type { ModelDTO } from "@/lib/schemas/model"

function makeModel(overrides: Partial<ModelDTO> = {}): ModelDTO {
    return {
        id: "model_1",
        name: "gpt-4o",
        model_id: "gpt-4o",
        proxy: null,
        timeout: 30,
        max_retries: 2,
        default_params: {},
        type: "chat",
        api_variant_id: null,
        resolved_variant_id: null,
        pricing: null,
        output_dimension: null,
        context_window: null,
        max_tokens: null,
        description: null,
        knowledge_date: null,
        provider: "openai",
        provider_id: "provider_1",
        is_local: false,
        enabled: true,
        ...overrides,
    }
}

describe("CAPABILITY_HEURISTIC", () => {
    it("has an entry for every well-known capability", () => {
        for (const cap of [
            "embedding",
            "rerank",
            "image",
            "audio.speech",
            "audio.transcription",
            "video",
            "chat",
        ]) {
            expect(CAPABILITY_HEURISTIC[cap]).toBeInstanceOf(RegExp)
        }
    })
})

describe("matchesCapability", () => {
    it("short-circuits true when m.type exactly equals the capability, even if the name wouldn't match any heuristic", () => {
        const m = makeModel({ type: "chat", name: "totally-unrelated-widget-9000", model_id: "widget" })
        expect(matchesCapability(m, "chat")).toBe(true)
    })

    it("falls back to the name heuristic when type doesn't match", () => {
        const m = makeModel({ type: "unknown", name: "text-embedding-3-small", model_id: null })
        expect(matchesCapability(m, "embedding")).toBe(true)
    })

    it("falls back to the model_id heuristic when the name doesn't match but model_id does", () => {
        const m = makeModel({ type: "unknown", name: "My Custom Label", model_id: "text-embedding-3-small" })
        expect(matchesCapability(m, "embedding")).toBe(true)
    })

    it("returns false when neither type nor name nor model_id match the capability heuristic", () => {
        const m = makeModel({ type: "unknown", name: "My Custom Label", model_id: "some-id" })
        expect(matchesCapability(m, "embedding")).toBe(false)
    })

    it("returns false for an unknown capability with no heuristic entry (and non-matching type)", () => {
        const m = makeModel({ type: "chat", name: "gpt-4o" })
        expect(matchesCapability(m, "some-made-up-capability")).toBe(false)
    })

    it("returns true for an unknown capability with no heuristic entry when type matches exactly", () => {
        const m = makeModel({ type: "some-made-up-capability", name: "gpt-4o" })
        expect(matchesCapability(m, "some-made-up-capability")).toBe(true)
    })

    it("does not throw when model_id is null and only the heuristic path is exercised", () => {
        const m = makeModel({ type: "unknown", name: "no match here", model_id: null })
        expect(() => matchesCapability(m, "embedding")).not.toThrow()
        expect(matchesCapability(m, "embedding")).toBe(false)
    })

    describe("sampling of the real regexes", () => {
        it.each([
            ["text-embedding-3-small", "embedding"],
            ["bge-large-en", "embedding"],
            ["cohere-rerank-v3", "rerank"],
            ["gpt-4o", "chat"],
            ["claude-3-5-sonnet", "chat"],
            ["gemini-2.0-flash", "chat"],
            ["deepseek-v3", "chat"],
            ["dall-e-3", "image"],
            ["stable-diffusion-xl", "image"],
            ["whisper-1", "audio.transcription"],
            ["tts-1", "audio.speech"],
            ["sora-2", "video"],
        ] as const)("%s matches capability %s via the name heuristic", (name, capability) => {
            const m = makeModel({ type: "unknown", name, model_id: null })
            expect(matchesCapability(m, capability)).toBe(true)
        })

        it("does not cross-match unrelated capabilities", () => {
            const m = makeModel({ type: "unknown", name: "whisper-1", model_id: null })
            expect(matchesCapability(m, "chat")).toBe(false)
            expect(matchesCapability(m, "image")).toBe(false)
        })
    })
})
