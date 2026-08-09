import * as React from "react"
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest"
import { screen, waitFor, fireEvent, act, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { SpeechPlayground } from "@/components/playground/audio-speech/speech-playground"
import { useModalityStore } from "@/lib/stores/modality-store"
import { gateway } from "@/lib/api/gateway"
import { ApiError } from "@/lib/api/client"
import { toast } from "sonner"
import { renderWithClient, resetModalityStore } from "../../_render"
import { makeModel } from "../_fixtures"

vi.mock("@/lib/api/gateway", () => ({
    gateway: {
        speech: vi.fn(),
    },
}))

vi.mock("sonner", () => ({
    toast: { success: vi.fn(), error: vi.fn() },
}))

const useListMock = vi.fn()
vi.mock("@/lib/api/models", () => ({
    models: {
        useList: (...args: unknown[]) => useListMock(...args),
    },
}))

const SPEECH_MODELS = [
    makeModel({ id: "s1", name: "tts-1", model_id: "tts-1", type: "audio.speech" }),
    makeModel({ id: "s2", name: "gpt-4o-mini-tts", model_id: "gpt-4o-mini-tts", type: "audio.speech" }),
]

function fakeBlob(bytes = "fake-audio-bytes", type = "audio/mpeg") {
    return new Blob([bytes], { type })
}

beforeEach(() => {
    useListMock.mockReturnValue({ data: SPEECH_MODELS, isLoading: false })
})

afterEach(() => {
    resetModalityStore()
})

describe("SpeechPlayground — empty state", () => {
    it("shows a generic empty hint before any model is picked", () => {
        renderWithClient(<SpeechPlayground />)
        expect(screen.getByText("Pick a TTS model to begin.")).toBeInTheDocument()
        expect(screen.getByText(/quick brown fox/)).toBeInTheDocument()
    })

    it("switches hint copy once a model is picked", async () => {
        const user = userEvent.setup()
        renderWithClient(<SpeechPlayground />)
        await user.click(screen.getByRole("button", { name: /select a model/i }))
        await user.click(await screen.findByText("tts-1"))
        expect(screen.getByText("Tap a sample text, pick a voice, then Generate.")).toBeInTheDocument()
    })

    it("clicking a sample chip fills the text area", async () => {
        const user = userEvent.setup()
        renderWithClient(<SpeechPlayground />)
        await user.click(
            screen.getByText("Hey, did you see the weather? Maybe we should reschedule to next Tuesday instead."),
        )
        expect(
            screen.getByDisplayValue(
                "Hey, did you see the weather? Maybe we should reschedule to next Tuesday instead.",
            ),
        ).toBeInTheDocument()
    })

    it("typing directly into the text area updates its value", async () => {
        const user = userEvent.setup()
        renderWithClient(<SpeechPlayground />)
        const textarea = screen.getByPlaceholderText(/quick brown fox/)
        await user.type(textarea, "hand-typed speech text")
        expect(useModalityStore.getState().speech.text).toBe("hand-typed speech text")
    })
})

describe("SpeechPlayground — voice quick-picks", () => {
    it("highlights 'alloy' by default and switches highlight on click", async () => {
        const user = userEvent.setup()
        renderWithClient(<SpeechPlayground />)
        const alloyButton = screen.getByRole("button", { name: "alloy" })
        const novaButton = screen.getByRole("button", { name: "nova" })
        expect(alloyButton).toHaveClass("bg-foreground")
        expect(novaButton).not.toHaveClass("bg-foreground")

        await user.click(novaButton)
        expect(useModalityStore.getState().speech.params.voice).toBe("nova")
        expect(novaButton).toHaveClass("bg-foreground")
        expect(alloyButton).not.toHaveClass("bg-foreground")
    })
})

describe("SpeechPlayground — params popover", () => {
    it("shows no badge with defaults, and a badge once a param diverges", async () => {
        const user = userEvent.setup()
        renderWithClient(<SpeechPlayground />)
        const paramsButton = screen.getByRole("button", { name: /params/i })
        expect(within(paramsButton).queryByText(/^\d+$/)).not.toBeInTheDocument()

        await user.click(paramsButton)
        const formatRow = screen.getByText("Format").closest("div")!
        await user.click(within(formatRow).getByRole("combobox"))
        await user.click(await screen.findByRole("option", { name: "wav" }))

        expect(useModalityStore.getState().speech.params.response_format).toBe("wav")
        expect(
            within(screen.getByRole("button", { name: /params/i })).getByText("1"),
        ).toBeInTheDocument()
    })

    it("the custom voice input overrides the quick-pick selection", async () => {
        const user = userEvent.setup()
        renderWithClient(<SpeechPlayground />)
        await user.click(screen.getByRole("button", { name: /params/i }))
        const voiceRow = screen.getByText("Custom voice").closest("div")!
        const voiceInput = within(voiceRow).getByPlaceholderText("Override the inline picker")
        fireEvent.change(voiceInput, { target: { value: "custom-voice-1" } })

        expect(useModalityStore.getState().speech.params.voice).toBe("custom-voice-1")
        expect(screen.getByRole("button", { name: "alloy" })).not.toHaveClass("bg-foreground")
    })

    it("clearing the custom voice input back to empty falls back to DEFAULTS.voice ('alloy')", async () => {
        const user = userEvent.setup()
        renderWithClient(<SpeechPlayground />)
        await user.click(screen.getByRole("button", { name: /params/i }))
        const voiceRow = screen.getByText("Custom voice").closest("div")!
        const voiceInput = within(voiceRow).getByPlaceholderText("Override the inline picker")

        fireEvent.change(voiceInput, { target: { value: "custom-voice-1" } })
        fireEvent.change(voiceInput, { target: { value: "" } })

        expect(useModalityStore.getState().speech.params.voice).toBe("alloy")
        expect(screen.getByRole("button", { name: "alloy" })).toHaveClass("bg-foreground")
    })

    it("typing into the Instructions textarea sets a style instruction", async () => {
        const user = userEvent.setup()
        renderWithClient(<SpeechPlayground />)
        await user.click(screen.getByRole("button", { name: /params/i }))
        const instructionsRow = screen.getByText("Instructions").closest("div")!
        const instructionsArea = within(instructionsRow).getByPlaceholderText(/Optional voice style/)

        fireEvent.change(instructionsArea, { target: { value: "sound cheerful" } })
        expect(useModalityStore.getState().speech.params.instructions).toBe("sound cheerful")

        fireEvent.change(instructionsArea, { target: { value: "" } })
        expect(useModalityStore.getState().speech.params.instructions).toBeUndefined()
    })

    it("the speed slider updates the estimate hint and the popover label", async () => {
        const user = userEvent.setup()
        useModalityStore.getState().patchSpeech({ text: "a".repeat(140) })
        renderWithClient(<SpeechPlayground />)
        // 140 chars / 14 chars-per-sec / speed(1) = 10s.
        expect(screen.getByText("10")).toBeInTheDocument()

        await user.click(screen.getByRole("button", { name: /params/i }))
        const speedRow = screen.getByText(/^Speed/).closest("div")!
        fireEvent.change(within(speedRow).getByRole("slider"), { target: { value: "2" } })

        expect(useModalityStore.getState().speech.params.speed).toBe(2)
        // 140 / 14 / 2 = 5s.
        expect(screen.getByText("5")).toBeInTheDocument()
    })

    it("Reset restores the full DEFAULTS object (voice, format, speed, and clears instructions)", async () => {
        const user = userEvent.setup()
        useModalityStore.getState().patchSpeech({
            params: { voice: "nova", response_format: "wav", speed: 2, instructions: "sound sleepy" },
        })
        renderWithClient(<SpeechPlayground />)
        await user.click(screen.getByRole("button", { name: /params/i }))
        expect(screen.getByRole("button", { name: /reset/i })).toBeInTheDocument()

        await user.click(screen.getByRole("button", { name: /reset/i }))
        expect(useModalityStore.getState().speech.params).toEqual({
            voice: "alloy",
            response_format: "mp3",
            speed: 1,
        })
    })
})

describe("SpeechPlayground — validation toasts (⌘/Ctrl+Enter bypasses the disabled button)", () => {
    it("toasts when no model is picked", () => {
        useModalityStore.getState().patchSpeech({ text: "hello" })
        renderWithClient(<SpeechPlayground />)
        fireEvent.keyDown(screen.getByPlaceholderText(/quick brown fox/), {
            key: "Enter",
            ctrlKey: true,
        })
        expect(toast.error).toHaveBeenCalledWith("Pick a TTS model")
    })

    it("toasts when the text is empty", () => {
        useModalityStore.getState().patchSpeech({ model: "tts-1" })
        renderWithClient(<SpeechPlayground />)
        fireEvent.keyDown(screen.getByPlaceholderText(/quick brown fox/), {
            key: "Enter",
            ctrlKey: true,
        })
        expect(toast.error).toHaveBeenCalledWith("Enter text to synthesise")
    })
})

describe("SpeechPlayground — submit flow", () => {
    it("calls gateway.speech with the trimmed text + params and renders the audio result", async () => {
        const user = userEvent.setup()
        const createSpy = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:audio-1")
        useModalityStore.getState().patchSpeech({ model: "tts-1", text: "  hello world  " })
        vi.mocked(gateway.speech).mockResolvedValue(fakeBlob())
        renderWithClient(<SpeechPlayground />)

        await user.click(screen.getByRole("button", { name: /^generate$/i }))

        await waitFor(() => expect(gateway.speech).toHaveBeenCalledTimes(1))
        expect(gateway.speech).toHaveBeenCalledWith({
            model: "tts-1",
            input: "hello world",
            voice: "alloy",
            response_format: "mp3",
            speed: 1,
            instructions: undefined,
        })

        const audioEl = document.querySelector("audio")
        expect(audioEl).toHaveAttribute("src", "blob:audio-1")
        expect(screen.getByText(/mp3/)).toBeInTheDocument()
        const downloadLink = screen.getByRole("link", { name: /download/i })
        expect(downloadLink).toHaveAttribute("href", "blob:audio-1")
        expect(downloadLink.getAttribute("download")).toMatch(/^speech-\d+\.mp3$/)

        createSpy.mockRestore()
    })

    it("sends instructions only when non-empty, otherwise undefined", async () => {
        const user = userEvent.setup()
        vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:audio-2")
        useModalityStore.getState().patchSpeech({
            model: "tts-1",
            text: "hi",
            params: { voice: "alloy", response_format: "mp3", speed: 1, instructions: "speak softly" },
        })
        vi.mocked(gateway.speech).mockResolvedValue(fakeBlob())
        renderWithClient(<SpeechPlayground />)

        await user.click(screen.getByRole("button", { name: /^generate$/i }))
        await waitFor(() =>
            expect(gateway.speech).toHaveBeenCalledWith(
                expect.objectContaining({ instructions: "speak softly" }),
            ),
        )
    })

    it("revokes the previous blob URL only when replacing an existing result (not the very first run)", async () => {
        const user = userEvent.setup()
        const revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {})
        vi.spyOn(URL, "createObjectURL")
            .mockReturnValueOnce("blob:audio-first")
            .mockReturnValueOnce("blob:audio-second")
        useModalityStore.getState().patchSpeech({ model: "tts-1", text: "hi" })
        vi.mocked(gateway.speech).mockResolvedValue(fakeBlob())
        renderWithClient(<SpeechPlayground />)

        await user.click(screen.getByRole("button", { name: /^generate$/i }))
        await waitFor(() => expect(document.querySelector("audio")).toHaveAttribute("src", "blob:audio-first"))
        expect(revokeSpy).not.toHaveBeenCalled()

        await user.click(screen.getByRole("button", { name: /^generate$/i }))
        await waitFor(() => expect(document.querySelector("audio")).toHaveAttribute("src", "blob:audio-second"))
        expect(revokeSpy).toHaveBeenCalledWith("blob:audio-first")
        expect(revokeSpy).not.toHaveBeenCalledWith("blob:audio-second")

        revokeSpy.mockRestore()
    })

    it("shows a disabled, 'Synthesising…' submit button while in flight", async () => {
        const user = userEvent.setup()
        useModalityStore.getState().patchSpeech({ model: "tts-1", text: "hi" })
        let resolvePromise!: (v: Blob) => void
        vi.mocked(gateway.speech).mockImplementation(
            () => new Promise((resolve) => { resolvePromise = resolve }),
        )
        renderWithClient(<SpeechPlayground />)

        await user.click(screen.getByRole("button", { name: /^generate$/i }))
        const runningButton = await screen.findByRole("button", { name: /synthesising/i })
        expect(runningButton).toBeDisabled()

        await act(async () => {
            resolvePromise(fakeBlob())
        })
        expect(await screen.findByRole("button", { name: /^generate$/i })).not.toBeDisabled()
    })

    it("shows the ApiError message via toast.error and an error card on failure", async () => {
        const user = userEvent.setup()
        useModalityStore.getState().patchSpeech({ model: "tts-1", text: "hi" })
        vi.mocked(gateway.speech).mockRejectedValue(new ApiError("synth failed", 500))
        renderWithClient(<SpeechPlayground />)

        await user.click(screen.getByRole("button", { name: /^generate$/i }))
        expect(await screen.findByText("synth failed")).toBeInTheDocument()
        expect(toast.error).toHaveBeenCalledWith("synth failed")
    })

    it("a plain (non-ApiError) Error rejecting still surfaces its message", async () => {
        const user = userEvent.setup()
        useModalityStore.getState().patchSpeech({ model: "tts-1", text: "hi" })
        vi.mocked(gateway.speech).mockRejectedValue(new Error("network down"))
        renderWithClient(<SpeechPlayground />)

        await user.click(screen.getByRole("button", { name: /^generate$/i }))
        expect(await screen.findByText("network down")).toBeInTheDocument()
        expect(toast.error).toHaveBeenCalledWith("network down")
    })

    it("a non-Error throw falls back to String(e)", async () => {
        const user = userEvent.setup()
        useModalityStore.getState().patchSpeech({ model: "tts-1", text: "hi" })
        vi.mocked(gateway.speech).mockRejectedValue("raw string rejection")
        renderWithClient(<SpeechPlayground />)

        await user.click(screen.getByRole("button", { name: /^generate$/i }))
        expect(await screen.findByText("raw string rejection")).toBeInTheDocument()
    })

    it("clears a stale error after a subsequent successful submission", async () => {
        const user = userEvent.setup()
        vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:audio-3")
        useModalityStore.getState().patchSpeech({ model: "tts-1", text: "hi" })
        vi.mocked(gateway.speech).mockRejectedValueOnce(new ApiError("first failure", 500))
        renderWithClient(<SpeechPlayground />)

        await user.click(screen.getByRole("button", { name: /^generate$/i }))
        expect(await screen.findByText("first failure")).toBeInTheDocument()

        vi.mocked(gateway.speech).mockResolvedValueOnce(fakeBlob())
        await user.click(screen.getByRole("button", { name: /^generate$/i }))

        await waitFor(() => expect(screen.queryByText("first failure")).not.toBeInTheDocument())
        expect(document.querySelector("audio")).toBeInTheDocument()
    })
})
