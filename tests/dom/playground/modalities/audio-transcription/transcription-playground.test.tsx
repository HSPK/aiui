import * as React from "react"
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest"
import { screen, waitFor, fireEvent, act, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { TranscriptionPlayground } from "@/components/playground/audio-transcription/transcription-playground"
import { useModalityStore } from "@/lib/stores/modality-store"
import { gateway } from "@/lib/api/gateway"
import type { TranscriptionResponse } from "@/lib/api/gateway"
import { ApiError } from "@/lib/api/client"
import { toast } from "sonner"
import { copyToClipboard } from "@/lib/clipboard"
import { renderWithClient, resetModalityStore } from "../../_render"
import { makeModel } from "../_fixtures"

vi.mock("@/lib/api/gateway", () => ({
    gateway: {
        transcribe: vi.fn(),
    },
}))

vi.mock("sonner", () => ({
    toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock("@/lib/clipboard", () => ({
    copyToClipboard: vi.fn(),
}))

const useListMock = vi.fn()
vi.mock("@/lib/api/models", () => ({
    models: {
        useList: (...args: unknown[]) => useListMock(...args),
    },
}))

const TRANSCRIPTION_MODELS = [
    makeModel({ id: "t1", name: "whisper-1", model_id: "whisper-1", type: "audio.transcription" }),
]

function makeFile(name = "test.mp3", type = "audio/mpeg", sizeBytes?: number) {
    const file = new File(["fake-audio-bytes"], name, { type })
    if (sizeBytes != null) Object.defineProperty(file, "size", { value: sizeBytes })
    return file
}

function fileInput() {
    return document.querySelector('input[type="file"]') as HTMLInputElement
}

beforeEach(() => {
    useListMock.mockReturnValue({ data: TRANSCRIPTION_MODELS, isLoading: false })
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:audio-preview")
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {})
})

afterEach(() => {
    resetModalityStore()
    vi.restoreAllMocks()
})

describe("TranscriptionPlayground — empty state", () => {
    it("shows a generic empty hint before any model is picked", () => {
        renderWithClient(<TranscriptionPlayground />)
        expect(screen.getByText("Pick a transcription model to begin.")).toBeInTheDocument()
    })

    it("switches hint copy once a model is picked", async () => {
        const user = userEvent.setup()
        renderWithClient(<TranscriptionPlayground />)
        await user.click(screen.getByRole("button", { name: /select a model/i }))
        await user.click(await screen.findByText("whisper-1"))
        expect(
            screen.getByText(/Drop an audio file above .* and Loom sends it to Whisper\./),
        ).toBeInTheDocument()
    })
})

describe("TranscriptionPlayground — no keyboard-shortcut validation path exists", () => {
    // Unlike the other 4 modality playgrounds, this component has no
    // onKeyDown/⌘+Enter bypass anywhere (confirmed by reading the whole
    // file) — the submit button is simply `disabled={!canRun}` with no
    // alternate way to invoke `handleRun` while invalid. The two
    // `toast.error("Pick a transcription model")` /
    // `toast.error("Upload an audio file")` guards inside `handleRun`
    // are therefore unreachable dead code from the UI; there is no
    // black-box way to exercise them, so they're intentionally not
    // covered here (see final report).
    it("the submit button is simply disabled with no model/file, with no bypass", () => {
        renderWithClient(<TranscriptionPlayground />)
        expect(screen.getByRole("button", { name: /transcribe/i })).toBeDisabled()
    })
})

describe("TranscriptionPlayground — file upload", () => {
    it("attaches a file, shows metadata + audio preview, and enables the submit button", async () => {
        const user = userEvent.setup()
        useModalityStore.getState().patchTranscription({ model: "whisper-1" })
        renderWithClient(<TranscriptionPlayground />)

        const file = makeFile("meeting.mp3")
        await user.upload(fileInput(), file)

        expect(screen.getByText("meeting.mp3")).toBeInTheDocument()
        expect(document.querySelector("audio")).toHaveAttribute("src", "blob:audio-preview")
        expect(screen.getByRole("button", { name: /^transcribe$/i })).not.toBeDisabled()
    })

    it("falls back to a generic 'audio' label when the attached file reports no MIME type", async () => {
        const user = userEvent.setup()
        useModalityStore.getState().patchTranscription({ model: "whisper-1" })
        renderWithClient(<TranscriptionPlayground />)

        await user.upload(fileInput(), makeFile("track.mp3", ""))

        expect(screen.getByText(/· audio$/)).toBeInTheDocument()
    })

    it("rejects a file over 25 MB with a toast and does not attach it", async () => {
        const user = userEvent.setup()
        renderWithClient(<TranscriptionPlayground />)
        const big = makeFile("huge.wav", "audio/wav", 26 * 1024 * 1024)

        await user.upload(fileInput(), big)

        expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/too large.*26\.0 MB.*limit 25 MB/))
        expect(screen.queryByText("huge.wav")).not.toBeInTheDocument()
        expect(screen.getByText(/Drop an audio file here/)).toBeInTheDocument()
    })

    it("selecting a NEW file clears a stale result/error", async () => {
        const user = userEvent.setup()
        useModalityStore.getState().patchTranscription({
            model: "whisper-1",
            result: { payload: "old transcript", format: "text", file_name: "old.mp3", file_bytes: 10, elapsed_ms: 5 },
            error: "old error",
        })
        renderWithClient(<TranscriptionPlayground />)
        expect(screen.getByText("old error")).toBeInTheDocument()

        await user.upload(fileInput(), makeFile("new.mp3"))

        expect(useModalityStore.getState().transcription.result).toBeNull()
        expect(useModalityStore.getState().transcription.error).toBeNull()
        expect(screen.queryByText("old error")).not.toBeInTheDocument()
    })

    it("BEHAVIOR: removing the attached file (X) does NOT clear a stale result/error, unlike picking a new file", async () => {
        const user = userEvent.setup()
        useModalityStore.getState().patchTranscription({
            model: "whisper-1",
            result: { payload: "old transcript", format: "text", file_name: "old.mp3", file_bytes: 10, elapsed_ms: 5 },
        })
        renderWithClient(<TranscriptionPlayground />)
        await user.upload(fileInput(), makeFile("keep-me.mp3"))
        // Uploading clears the stale result (see previous test) — reprime
        // it directly to isolate the remove-button's own effect on the
        // (now-empty-file) state. Wrapped in act() since this is a
        // post-mount external-store update (unlike pre-mount priming,
        // which is just reflected on initial render with no flush needed).
        act(() => {
            useModalityStore.getState().patchTranscription({
                result: { payload: "old transcript", format: "text", file_name: "old.mp3", file_bytes: 10, elapsed_ms: 5 },
            })
        })
        expect(screen.getAllByText("old transcript").length).toBeGreaterThan(0)

        await user.click(screen.getByRole("button", { name: /remove file/i }))

        expect(screen.getByText(/Drop an audio file here/)).toBeInTheDocument() // dropzone is back
        expect(useModalityStore.getState().transcription.result?.payload).toBe("old transcript") // but stale result lingers
    })

    it("supports drag-and-drop onto the dropzone", async () => {
        useModalityStore.getState().patchTranscription({ model: "whisper-1" })
        renderWithClient(<TranscriptionPlayground />)
        const dropzone = screen.getByText(/Drop an audio file here/).closest("label")!
        const file = makeFile("dropped.mp3")

        fireEvent.drop(dropzone, { dataTransfer: { files: [file] } })

        expect(await screen.findByText("dropped.mp3")).toBeInTheDocument()
    })

    it("highlights the dropzone on dragOver and reverts it on dragLeave", () => {
        useModalityStore.getState().patchTranscription({ model: "whisper-1" })
        renderWithClient(<TranscriptionPlayground />)
        const dropzone = screen.getByText(/Drop an audio file here/).closest("label")!

        expect(dropzone.className).toContain("border-muted-foreground/30")
        fireEvent.dragOver(dropzone)
        expect(dropzone.className).toContain("border-primary")
        fireEvent.dragLeave(dropzone)
        expect(dropzone.className).toContain("border-muted-foreground/30")
        expect(dropzone.className).not.toContain("border-primary")
    })
})

describe("TranscriptionPlayground — params popover", () => {
    it("shows no badge with defaults, and a badge once a param diverges", async () => {
        const user = userEvent.setup()
        renderWithClient(<TranscriptionPlayground />)
        const paramsButton = screen.getByRole("button", { name: /params/i })
        expect(within(paramsButton).queryByText(/^\d+$/)).not.toBeInTheDocument()

        await user.click(paramsButton)
        const langRow = screen.getByText("Language (ISO-639-1)").closest("div")!
        const langInput = within(langRow).getByPlaceholderText("auto")
        expect(langInput).toHaveAttribute("maxlength", "5")
        fireEvent.change(langInput, { target: { value: "en" } })

        expect(useModalityStore.getState().transcription.params.language).toBe("en")
        expect(within(screen.getByRole("button", { name: /params/i })).getByText("1")).toBeInTheDocument()
    })

    it("clearing the language input back to empty resets it to undefined (not '')", async () => {
        const user = userEvent.setup()
        renderWithClient(<TranscriptionPlayground />)
        await user.click(screen.getByRole("button", { name: /params/i }))
        const langRow = screen.getByText("Language (ISO-639-1)").closest("div")!
        const langInput = within(langRow).getByPlaceholderText("auto")

        fireEvent.change(langInput, { target: { value: "en" } })
        fireEvent.change(langInput, { target: { value: "" } })

        expect(useModalityStore.getState().transcription.params.language).toBeUndefined()
    })

    it("clearing the prompt textarea back to empty resets it to undefined (not '')", async () => {
        const user = userEvent.setup()
        renderWithClient(<TranscriptionPlayground />)
        await user.click(screen.getByRole("button", { name: /params/i }))
        const promptRow = screen.getByText("Prompt (optional bias)").closest("div")!
        const promptArea = within(promptRow).getByPlaceholderText(/Hint domain vocabulary/)

        fireEvent.change(promptArea, { target: { value: "Loom, Copilot" } })
        fireEvent.change(promptArea, { target: { value: "" } })

        expect(useModalityStore.getState().transcription.params.prompt).toBeUndefined()
    })

    it("the temperature input accepts a number and clears back to undefined", async () => {
        renderWithClient(<TranscriptionPlayground />)
        const user = userEvent.setup()
        await user.click(screen.getByRole("button", { name: /params/i }))
        const tempRow = screen.getByText("Temperature").closest("div")!
        const tempInput = within(tempRow).getByPlaceholderText("Default")

        fireEvent.change(tempInput, { target: { value: "0.5" } })
        expect(useModalityStore.getState().transcription.params.temperature).toBe(0.5)

        fireEvent.change(tempInput, { target: { value: "" } })
        expect(useModalityStore.getState().transcription.params.temperature).toBeUndefined()
    })

    it("the prompt textarea sets a bias prompt", async () => {
        const user = userEvent.setup()
        renderWithClient(<TranscriptionPlayground />)
        await user.click(screen.getByRole("button", { name: /params/i }))
        const promptRow = screen.getByText("Prompt (optional bias)").closest("div")!
        const promptArea = within(promptRow).getByPlaceholderText(/Hint domain vocabulary/)
        fireEvent.change(promptArea, { target: { value: "Loom, Copilot" } })
        expect(useModalityStore.getState().transcription.params.prompt).toBe("Loom, Copilot")
    })

    it("switches the response format via the Select", async () => {
        const user = userEvent.setup()
        renderWithClient(<TranscriptionPlayground />)
        await user.click(screen.getByRole("button", { name: /params/i }))
        const formatRow = screen.getByText("Response format").closest("div")!
        await user.click(within(formatRow).getByRole("combobox"))
        await user.click(await screen.findByRole("option", { name: "srt" }))
        expect(useModalityStore.getState().transcription.params.response_format).toBe("srt")
    })

    it("Reset restores DEFAULTS ({response_format: 'verbose_json'}), clearing language/prompt/temperature", async () => {
        const user = userEvent.setup()
        useModalityStore.getState().patchTranscription({
            params: { language: "en", prompt: "bias", response_format: "srt", temperature: 0.7 },
        })
        renderWithClient(<TranscriptionPlayground />)
        await user.click(screen.getByRole("button", { name: /params/i }))
        await user.click(screen.getByRole("button", { name: /reset/i }))

        expect(useModalityStore.getState().transcription.params).toEqual({ response_format: "verbose_json" })
    })
})

describe("TranscriptionPlayground — submit flow", () => {
    it("calls gateway.transcribe with the expected args and renders a JSON-object result", async () => {
        const user = userEvent.setup()
        useModalityStore.getState().patchTranscription({ model: "whisper-1" })
        const jsonResult: TranscriptionResponse = {
            text: "Hello world, this is a test.",
            language: "english",
            duration: 12.34,
            segments: [
                { id: 0, start: 0, end: 5.2, text: "Hello world," },
                { id: 1, start: 5.2, end: 12.34, text: "this is a test." },
            ],
        }
        vi.mocked(gateway.transcribe).mockResolvedValue(jsonResult)
        renderWithClient(<TranscriptionPlayground />)
        await user.upload(fileInput(), makeFile("meeting.mp3"))

        await user.click(screen.getByRole("button", { name: /^transcribe$/i }))

        await waitFor(() => expect(gateway.transcribe).toHaveBeenCalledTimes(1))
        const callArgs = vi.mocked(gateway.transcribe).mock.calls[0][0]
        expect(callArgs.model).toBe("whisper-1")
        expect(callArgs.file.name).toBe("meeting.mp3")
        expect(callArgs.response_format).toBe("verbose_json")
        expect(callArgs.language).toBeUndefined()

        expect(await screen.findByText("Hello world, this is a test.")).toBeInTheDocument()
        expect(screen.getByText("english")).toBeInTheDocument()
        expect(screen.getByText("12.3s audio")).toBeInTheDocument()
        expect(screen.getByText("Segments (2)")).toBeInTheDocument()
        expect(screen.getByText("Hello world,")).toBeInTheDocument()
    })

    it("renders a plain-string result (response_format: text) without segments/language/duration", async () => {
        const user = userEvent.setup()
        useModalityStore.getState().patchTranscription({
            model: "whisper-1",
            params: { response_format: "text" },
        })
        vi.mocked(gateway.transcribe).mockResolvedValue("Just plain text back from upstream.")
        renderWithClient(<TranscriptionPlayground />)
        await user.upload(fileInput(), makeFile("meeting.mp3"))

        await user.click(screen.getByRole("button", { name: /^transcribe$/i }))

        // Both the main transcript <pre> AND the "Raw payload" <pre> show the
        // same verbatim string for a string result (there's no distinct JSON
        // structure to unwrap), so there are two matches — not a false positive.
        const matches = await screen.findAllByText("Just plain text back from upstream.")
        expect(matches).toHaveLength(2)
        expect(screen.queryByText(/Segments/)).not.toBeInTheDocument()
        // Raw payload for a string result is the bare string, not JSON.stringify(...).
        const rawPayloadDetails = screen.getByText("Raw payload").closest("details")!
        expect(within(rawPayloadDetails).getByText("Just plain text back from upstream.")).toBeInTheDocument()
    })

    it("shows a disabled, 'Transcribing…' submit button (with the file-size hint) while in flight", async () => {
        const user = userEvent.setup()
        useModalityStore.getState().patchTranscription({ model: "whisper-1" })
        let resolvePromise!: (v: TranscriptionResponse) => void
        vi.mocked(gateway.transcribe).mockImplementation(
            () => new Promise((resolve) => { resolvePromise = resolve }),
        )
        renderWithClient(<TranscriptionPlayground />)
        await user.upload(fileInput(), makeFile("meeting.mp3"))

        await user.click(screen.getByRole("button", { name: /^transcribe$/i }))
        const runningButton = await screen.findByRole("button", { name: /transcribing/i })
        expect(runningButton).toBeDisabled()

        await act(async () => {
            resolvePromise({ text: "done" })
        })
        expect(await screen.findByText("done")).toBeInTheDocument()
    })

    it("shows the ApiError message via toast.error and an error card on failure", async () => {
        const user = userEvent.setup()
        useModalityStore.getState().patchTranscription({ model: "whisper-1" })
        vi.mocked(gateway.transcribe).mockRejectedValue(new ApiError("bad audio codec", 422))
        renderWithClient(<TranscriptionPlayground />)
        await user.upload(fileInput(), makeFile("meeting.mp3"))

        await user.click(screen.getByRole("button", { name: /^transcribe$/i }))
        expect(await screen.findByText("bad audio codec")).toBeInTheDocument()
        expect(toast.error).toHaveBeenCalledWith("bad audio codec")
    })

    it("a plain (non-ApiError) Error rejecting still surfaces its message", async () => {
        const user = userEvent.setup()
        useModalityStore.getState().patchTranscription({ model: "whisper-1" })
        vi.mocked(gateway.transcribe).mockRejectedValue(new Error("network down"))
        renderWithClient(<TranscriptionPlayground />)
        await user.upload(fileInput(), makeFile("meeting.mp3"))

        await user.click(screen.getByRole("button", { name: /^transcribe$/i }))
        expect(await screen.findByText("network down")).toBeInTheDocument()
        expect(toast.error).toHaveBeenCalledWith("network down")
    })

    it("a non-Error throw falls back to String(e)", async () => {
        const user = userEvent.setup()
        useModalityStore.getState().patchTranscription({ model: "whisper-1" })
        vi.mocked(gateway.transcribe).mockRejectedValue("raw string rejection")
        renderWithClient(<TranscriptionPlayground />)
        await user.upload(fileInput(), makeFile("meeting.mp3"))

        await user.click(screen.getByRole("button", { name: /^transcribe$/i }))
        expect(await screen.findByText("raw string rejection")).toBeInTheDocument()
    })

    it("falls back to an empty transcript when a JSON-object payload has no `.text`", async () => {
        const user = userEvent.setup()
        useModalityStore.getState().patchTranscription({ model: "whisper-1" })
        vi.mocked(gateway.transcribe).mockResolvedValue({
            language: "english",
            duration: 3,
        } as unknown as TranscriptionResponse)
        renderWithClient(<TranscriptionPlayground />)
        await user.upload(fileInput(), makeFile("meeting.mp3"))

        await user.click(screen.getByRole("button", { name: /^transcribe$/i }))
        expect(await screen.findByText("english")).toBeInTheDocument()
        // The Copy button's own disabled-when-empty check confirms the
        // component resolved `text` to "" rather than throwing/rendering
        // "undefined".
        expect(screen.getByRole("button", { name: /^copy$/i })).toBeDisabled()
    })

    it("clears a stale error after a subsequent successful submission", async () => {
        const user = userEvent.setup()
        useModalityStore.getState().patchTranscription({ model: "whisper-1" })
        vi.mocked(gateway.transcribe).mockRejectedValueOnce(new ApiError("first failure", 500))
        renderWithClient(<TranscriptionPlayground />)
        await user.upload(fileInput(), makeFile("meeting.mp3"))

        await user.click(screen.getByRole("button", { name: /^transcribe$/i }))
        expect(await screen.findByText("first failure")).toBeInTheDocument()

        vi.mocked(gateway.transcribe).mockResolvedValueOnce({ text: "recovered transcript" })
        await user.click(screen.getByRole("button", { name: /^transcribe$/i }))

        await waitFor(() => expect(screen.queryByText("first failure")).not.toBeInTheDocument())
        expect(screen.getByText("recovered transcript")).toBeInTheDocument()
    })
})

describe("TranscriptionPlayground — copy button", () => {
    afterEach(() => {
        vi.useRealTimers()
    })

    it("copies the transcript, flips to 'Copied' for ~1.8s, then reverts", async () => {
        const user = userEvent.setup()
        useModalityStore.getState().patchTranscription({
            model: "whisper-1",
            result: { payload: "copy me", format: "text", file_name: "a.mp3", file_bytes: 1, elapsed_ms: 1 },
        })
        vi.mocked(copyToClipboard).mockResolvedValue(true)
        renderWithClient(<TranscriptionPlayground />)

        vi.useFakeTimers()
        fireEvent.click(screen.getByRole("button", { name: /^copy$/i }))
        await act(async () => {
            await vi.advanceTimersByTimeAsync(0)
        })
        expect(copyToClipboard).toHaveBeenCalledWith("copy me")
        expect(screen.getByRole("button", { name: /copied/i })).toBeInTheDocument()

        await act(async () => {
            await vi.advanceTimersByTimeAsync(1800)
        })
        expect(screen.getByRole("button", { name: /^copy$/i })).toBeInTheDocument()
    })

    it("is disabled when the transcript text is empty", () => {
        useModalityStore.getState().patchTranscription({
            model: "whisper-1",
            result: { payload: { text: "" }, format: "verbose_json", file_name: "a.mp3", file_bytes: 1, elapsed_ms: 1 },
        })
        renderWithClient(<TranscriptionPlayground />)
        expect(screen.getByRole("button", { name: /^copy$/i })).toBeDisabled()
        expect(screen.getByText(/No text returned/)).toBeInTheDocument()
    })

    it("does not flip to 'Copied' when the clipboard write itself fails (ok=false)", async () => {
        useModalityStore.getState().patchTranscription({
            model: "whisper-1",
            result: { payload: "copy me", format: "text", file_name: "a.mp3", file_bytes: 1, elapsed_ms: 1 },
        })
        vi.mocked(copyToClipboard).mockResolvedValue(false)
        renderWithClient(<TranscriptionPlayground />)

        fireEvent.click(screen.getByRole("button", { name: /^copy$/i }))
        await waitFor(() => expect(copyToClipboard).toHaveBeenCalledWith("copy me"))
        expect(screen.getByRole("button", { name: /^copy$/i })).toBeInTheDocument()
        expect(screen.queryByRole("button", { name: /copied/i })).not.toBeInTheDocument()
    })

    it("clicking Copy again before the revert timer fires clears the pending timer first", async () => {
        useModalityStore.getState().patchTranscription({
            model: "whisper-1",
            result: { payload: "copy me", format: "text", file_name: "a.mp3", file_bytes: 1, elapsed_ms: 1 },
        })
        vi.mocked(copyToClipboard).mockResolvedValue(true)
        renderWithClient(<TranscriptionPlayground />)

        vi.useFakeTimers()
        fireEvent.click(screen.getByRole("button", { name: /^copy$/i }))
        await act(async () => {
            await vi.advanceTimersByTimeAsync(0)
        })
        expect(screen.getByRole("button", { name: /copied/i })).toBeInTheDocument()

        // Second click while still "Copied" — exercises the
        // `if (copyTimerRef.current) clearTimeout(...)` guard replacing the
        // still-pending revert timer instead of leaving two scheduled.
        fireEvent.click(screen.getByRole("button", { name: /copied/i }))
        await act(async () => {
            await vi.advanceTimersByTimeAsync(0)
        })
        expect(copyToClipboard).toHaveBeenCalledTimes(2)

        await act(async () => {
            await vi.advanceTimersByTimeAsync(1800)
        })
        expect(screen.getByRole("button", { name: /^copy$/i })).toBeInTheDocument()
    })
})
