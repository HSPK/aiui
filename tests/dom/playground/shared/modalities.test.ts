import { describe, it, expect } from "vitest"

import {
    MODALITIES,
    DEFAULT_MODALITY_HREF,
    isModalityActive,
    modalityFromPath,
    type Modality,
} from "@/components/playground/modalities"

describe("MODALITIES", () => {
    it("has exactly 7 entries", () => {
        expect(MODALITIES).toHaveLength(7)
    })

    it("has unique ids and hrefs", () => {
        const ids = MODALITIES.map((m) => m.id)
        const hrefs = MODALITIES.map((m) => m.href)
        expect(new Set(ids).size).toBe(ids.length)
        expect(new Set(hrefs).size).toBe(hrefs.length)
    })

    it("has exactly one disabled entry: rerank", () => {
        const disabled = MODALITIES.filter((m) => m.disabled)
        expect(disabled).toHaveLength(1)
        expect(disabled[0].id).toBe("rerank")
    })

    it("every entry has the required display fields populated", () => {
        for (const m of MODALITIES) {
            expect(m.title).toBeTruthy()
            expect(m.description).toBeTruthy()
            expect(m.icon).toBeTruthy()
            expect(m.href).toMatch(/^\/playground\//)
            expect(m.accent).toMatch(/text-/)
        }
    })

    it("includes the chat modality with the expected href", () => {
        const chat = MODALITIES.find((m) => m.id === "chat")
        expect(chat).toBeDefined()
        expect(chat?.href).toBe("/playground/chat")
    })
})

describe("DEFAULT_MODALITY_HREF", () => {
    it("points at the chat modality's href", () => {
        const chat = MODALITIES.find((m) => m.id === "chat") as Modality
        expect(DEFAULT_MODALITY_HREF).toBe(chat.href)
        expect(DEFAULT_MODALITY_HREF).toBe("/playground/chat")
    })
})

describe("isModalityActive", () => {
    const chat = MODALITIES.find((m) => m.id === "chat") as Modality
    const audioTranscription = MODALITIES.find((m) => m.id === "audio-transcription") as Modality

    it("matches on an exact pathname equal to the modality href", () => {
        expect(isModalityActive("/playground/chat", chat)).toBe(true)
    })

    it("matches a nested/trailing-segment pathname (prefix + '/')", () => {
        expect(isModalityActive("/playground/chat/foo", chat)).toBe(true)
        expect(isModalityActive("/playground/audio/transcription/some-job-id", audioTranscription)).toBe(true)
    })

    it("does NOT match a pathname that merely shares the href as a text prefix without a separating slash", () => {
        // Off-by-one bug surface: a naive `pathname.startsWith(href)` (no
        // trailing-slash guard) would incorrectly treat "/playground/chatfoo"
        // as part of the "chat" modality. The real implementation guards
        // against this by requiring an exact match OR `href + "/"` prefix.
        expect(isModalityActive("/playground/chatfoo", chat)).toBe(false)
    })

    it("does not match unrelated pathnames", () => {
        expect(isModalityActive("/playground/embedding", chat)).toBe(false)
        expect(isModalityActive("/dashboard", chat)).toBe(false)
        expect(isModalityActive("/", chat)).toBe(false)
    })

    it("does not match a bare parent path with no trailing segment", () => {
        expect(isModalityActive("/playground", chat)).toBe(false)
    })

    it("treats a literal query string suffix as NOT matching, despite the doc comment's example", () => {
        // `modalities.ts`'s isModalityActive doc comment claims
        // "/playground/chat?c=…" highlights Chat, but the implementation
        // only checks `pathname === href` or `pathname.startsWith(href + "/")`.
        // "?c=1" is neither an exact match nor prefixed by "/", so this
        // literal input does NOT activate the modality. In real usage this
        // is harmless because `usePathname()` (the only caller) never
        // includes the query string — but the comment is misleading for
        // any other caller. See modalities.ts doc comment above
        // `isModalityActive`.
        expect(isModalityActive("/playground/chat?c=1", chat)).toBe(false)
    })

    it("works for the disabled rerank modality too (activeness is independent of `disabled`)", () => {
        const rerank = MODALITIES.find((m) => m.id === "rerank") as Modality
        expect(isModalityActive("/playground/rerank", rerank)).toBe(true)
        expect(isModalityActive("/playground/rerank/details", rerank)).toBe(true)
    })
})

describe("modalityFromPath", () => {
    it("finds the exact modality for a top-level path", () => {
        expect(modalityFromPath("/playground/embedding")?.id).toBe("embedding")
    })

    it("finds the modality for a nested path", () => {
        expect(modalityFromPath("/playground/audio/transcription/abc123")?.id).toBe("audio-transcription")
    })

    it("returns undefined for a path that doesn't fall under any modality", () => {
        expect(modalityFromPath("/dashboard")).toBeUndefined()
        expect(modalityFromPath("/")).toBeUndefined()
        expect(modalityFromPath("")).toBeUndefined()
    })

    it("disambiguates similarly-prefixed modalities (audio-speech vs audio-transcription)", () => {
        expect(modalityFromPath("/playground/audio/speech")?.id).toBe("audio-speech")
        expect(modalityFromPath("/playground/audio/transcription")?.id).toBe("audio-transcription")
    })

    it("still resolves the disabled rerank modality (callers decide what to do with `disabled`)", () => {
        expect(modalityFromPath("/playground/rerank")?.id).toBe("rerank")
    })
})
