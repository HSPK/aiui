import * as React from "react"
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest"
import { screen, waitFor, fireEvent, act, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { VideoPlayground } from "@/components/playground/video/video-playground"
import { useModalityStore } from "@/lib/stores/modality-store"
import { gateway } from "@/lib/api/gateway"
import type { VideoJob } from "@/lib/api/gateway"
import { ApiError } from "@/lib/api/client"
import { toast } from "sonner"
import { renderWithClient, resetModalityStore } from "../../_render"
import { makeModel } from "../_fixtures"

vi.mock("@/lib/api/gateway", () => ({
    gateway: {
        videoCreate: vi.fn(),
        videoGet: vi.fn(),
        videoDelete: vi.fn(),
        videoContentUrl: vi.fn(
            (id: string, _model: string, variant: string = "video") =>
                `https://cdn.example.com/${id}/${variant}`,
        ),
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

const VIDEO_MODELS = [
    makeModel({ id: "v1", name: "sora-2", model_id: "sora-2", type: "video" }),
    makeModel({ id: "v2", name: "veo-3", model_id: "veo-3", type: "video" }),
]

function makeJob(overrides: Partial<VideoJob> = {}): VideoJob {
    return {
        id: "job-1",
        object: "video",
        status: "queued",
        model: "sora-2",
        seconds: "8",
        size: "1280x720",
        progress: 0,
        created_at: 1700000000,
        ...overrides,
    }
}

beforeEach(() => {
    useListMock.mockReturnValue({ data: VIDEO_MODELS, isLoading: false })
})

afterEach(() => {
    resetModalityStore()
    vi.useRealTimers()
})

/** Advances the fake clock and flushes the resulting state update through
 *  `act`. `userEvent.click` hangs indefinitely once fake timers are active
 *  in this environment (its internal pointer-event bookkeeping appears to
 *  rely on a real timer), so every click that happens while fake timers
 *  are active in this file uses `fireEvent.click` on the plain
 *  (non-Radix-popover) submit/stop/delete buttons instead. */
async function advance(ms: number) {
    await act(async () => {
        await vi.advanceTimersByTimeAsync(ms)
    })
}

describe("VideoPlayground — empty state", () => {
    it("shows a generic empty hint before any model is picked", () => {
        renderWithClient(<VideoPlayground />)
        expect(screen.getByText("Pick a model and write a prompt to begin.")).toBeInTheDocument()
        expect(screen.getByText(/drone shot soaring/)).toBeInTheDocument()
    })

    it("switches hint copy once a model is picked", async () => {
        const user = userEvent.setup()
        renderWithClient(<VideoPlayground />)
        await user.click(screen.getByRole("button", { name: /select a model/i }))
        await user.click(await screen.findByText("sora-2"))
        expect(screen.getByText(/Loom polls the upstream until it's ready/)).toBeInTheDocument()
    })

    it("clicking a prompt chip fills the prompt textarea", async () => {
        const user = userEvent.setup()
        renderWithClient(<VideoPlayground />)
        await user.click(
            screen.getByText("A barista pulling a perfect espresso shot in slow motion, 4K macro"),
        )
        expect(
            screen.getByDisplayValue("A barista pulling a perfect espresso shot in slow motion, 4K macro"),
        ).toBeInTheDocument()
    })

    it("typing directly into the prompt textarea updates its value", async () => {
        const user = userEvent.setup()
        renderWithClient(<VideoPlayground />)
        const textarea = screen.getByPlaceholderText(/drone shot soaring/)
        await user.type(textarea, "hand-typed prompt")
        expect(useModalityStore.getState().video.prompt).toBe("hand-typed prompt")
    })
})

describe("VideoPlayground — params popover", () => {
    it("shows a badge once seconds/size are set, and updates the action hint text", async () => {
        const user = userEvent.setup()
        renderWithClient(<VideoPlayground />)

        const paramsButton = screen.getByRole("button", { name: /params/i })
        expect(within(paramsButton).queryByText(/^\d+$/)).not.toBeInTheDocument()

        await user.click(paramsButton)
        const secondsRow = screen.getByText("Seconds (4, 8, 12)").closest("div")!
        await user.click(within(secondsRow).getByRole("combobox"))
        await user.click(await screen.findByRole("option", { name: "8" }))

        expect(useModalityStore.getState().video.params.seconds).toBe("8")
        expect(screen.getByText(/Typically/)).toBeInTheDocument()
        expect(within(screen.getByRole("button", { name: /params/i })).getByText("1")).toBeInTheDocument()
    })

    it("Reset clears both seconds and size back to DEFAULTS ({})", async () => {
        const user = userEvent.setup()
        useModalityStore.getState().patchVideo({ params: { seconds: "8", size: "1280x720" } })
        renderWithClient(<VideoPlayground />)
        await user.click(screen.getByRole("button", { name: /params/i }))
        expect(screen.getByRole("button", { name: /reset/i })).toBeInTheDocument()

        await user.click(screen.getByRole("button", { name: /reset/i }))
        expect(useModalityStore.getState().video.params).toEqual({})
    })

    it("the Size row sets a concrete value, then clears back to undefined via its own 'Default' option", async () => {
        const user = userEvent.setup()
        renderWithClient(<VideoPlayground />)
        await user.click(screen.getByRole("button", { name: /params/i }))

        const sizeRow = screen.getByText("Size").closest("div")!
        await user.click(within(sizeRow).getByRole("combobox"))
        await user.click(await screen.findByRole("option", { name: "1280x720" }))
        expect(useModalityStore.getState().video.params.size).toBe("1280x720")

        // Re-open and pick "Default" from the dropdown itself (distinct from
        // the standalone Reset button) — exercises the `v === "default" ?
        // undefined : v` ternary's true branch for this field.
        await user.click(within(sizeRow).getByRole("combobox"))
        await user.click(await screen.findByRole("option", { name: "Default" }))
        expect(useModalityStore.getState().video.params.size).toBeUndefined()
    })

    it("the Seconds row's own 'Default' option clears seconds back to undefined", async () => {
        const user = userEvent.setup()
        useModalityStore.getState().patchVideo({ params: { seconds: "8" } })
        renderWithClient(<VideoPlayground />)
        await user.click(screen.getByRole("button", { name: /params/i }))

        const secondsRow = screen.getByText("Seconds (4, 8, 12)").closest("div")!
        await user.click(within(secondsRow).getByRole("combobox"))
        await user.click(await screen.findByRole("option", { name: "Default" }))
        expect(useModalityStore.getState().video.params.seconds).toBeUndefined()
    })
})

describe("VideoPlayground — validation toasts (⌘/Ctrl+Enter bypasses the disabled button)", () => {
    it("toasts when no model is picked", () => {
        useModalityStore.getState().patchVideo({ prompt: "a cat" })
        renderWithClient(<VideoPlayground />)
        fireEvent.keyDown(screen.getByPlaceholderText(/drone shot soaring/), {
            key: "Enter",
            ctrlKey: true,
        })
        expect(toast.error).toHaveBeenCalledWith("Pick a video model")
    })

    it("toasts when the prompt is empty", () => {
        useModalityStore.getState().patchVideo({ model: "sora-2" })
        renderWithClient(<VideoPlayground />)
        fireEvent.keyDown(screen.getByPlaceholderText(/drone shot soaring/), {
            key: "Enter",
            ctrlKey: true,
        })
        expect(toast.error).toHaveBeenCalledWith("Prompt is required")
    })
})

describe("VideoPlayground — reference image attach/remove", () => {
    it("attaches an image, shows a preview + metadata, and removes it back to the dropzone", async () => {
        const user = userEvent.setup()
        const createSpy = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock-ref")
        const revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {})
        renderWithClient(<VideoPlayground />)

        const file = new File(["fake-bytes"], "frame.png", { type: "image/png" })
        const input = document.querySelector('input[type="file"]') as HTMLInputElement
        await user.upload(input, file)

        expect(createSpy).toHaveBeenCalledWith(file)
        expect(screen.getByText("frame.png")).toBeInTheDocument()
        expect(screen.getByAltText("reference")).toHaveAttribute("src", "blob:mock-ref")

        await user.click(screen.getByRole("button", { name: /remove reference/i }))
        expect(screen.queryByText("frame.png")).not.toBeInTheDocument()
        expect(screen.getByText("+ image")).toBeInTheDocument()
        expect(revokeSpy).toHaveBeenCalledWith("blob:mock-ref")

        createSpy.mockRestore()
        revokeSpy.mockRestore()
    })
})

describe("VideoPlayground — submit + polling", () => {
    it("creates a job, shows the Stop-polling UI, then stops polling once the job completes", async () => {
        useModalityStore.getState().patchVideo({ model: "sora-2", prompt: "a cat wizard" })
        vi.mocked(gateway.videoCreate).mockResolvedValue(makeJob({ status: "queued", progress: 0 }))
        vi.mocked(gateway.videoGet)
            .mockResolvedValueOnce(makeJob({ status: "in_progress", progress: 50 }))
            .mockResolvedValueOnce(makeJob({ status: "completed", progress: 100 }))

        renderWithClient(<VideoPlayground />)
        vi.useFakeTimers()

        fireEvent.click(screen.getByRole("button", { name: /^generate$/i }))
        await advance(0)

        expect(gateway.videoCreate).toHaveBeenCalledWith(
            expect.objectContaining({ model: "sora-2", prompt: "a cat wizard" }),
        )
        expect(screen.getByRole("button", { name: /stop polling/i })).toBeInTheDocument()
        expect(screen.getByText(/Polling… 0%/)).toBeInTheDocument()
        expect(screen.getByText("job-1")).toBeInTheDocument()
        expect(screen.getByText("queued")).toBeInTheDocument()

        // First poll tick: still in_progress, keeps polling.
        await advance(4000)
        expect(gateway.videoGet).toHaveBeenCalledTimes(1)
        expect(gateway.videoGet).toHaveBeenCalledWith("job-1", "sora-2")
        expect(screen.getByRole("button", { name: /stop polling/i })).toBeInTheDocument()
        expect(screen.getByText("in_progress")).toBeInTheDocument()

        // Second poll tick: completed, polling stops.
        await advance(4000)
        expect(gateway.videoGet).toHaveBeenCalledTimes(2)
        expect(screen.queryByRole("button", { name: /stop polling/i })).not.toBeInTheDocument()
        expect(screen.getByText("completed")).toBeInTheDocument()
        const video = document.querySelector("video")
        expect(video).toHaveAttribute("src", "https://cdn.example.com/job-1/video")

        // Confirm polling really stopped: advancing further makes no new calls.
        await advance(8000)
        expect(gateway.videoGet).toHaveBeenCalledTimes(2)
    })

    it("does not poll at all when the job is already terminal on creation", async () => {
        useModalityStore.getState().patchVideo({ model: "sora-2", prompt: "a cat wizard" })
        vi.mocked(gateway.videoCreate).mockResolvedValue(makeJob({ status: "completed", progress: 100 }))

        renderWithClient(<VideoPlayground />)
        vi.useFakeTimers()
        fireEvent.click(screen.getByRole("button", { name: /^generate$/i }))
        await advance(0)

        expect(gateway.videoGet).not.toHaveBeenCalled()
        expect(screen.queryByRole("button", { name: /stop polling/i })).not.toBeInTheDocument()
        expect(screen.getByText("completed")).toBeInTheDocument()

        await advance(10000)
        expect(gateway.videoGet).not.toHaveBeenCalled()
    })

    it("renders a failed job's error message and no video element", async () => {
        useModalityStore.getState().patchVideo({ model: "sora-2", prompt: "a cat wizard" })
        vi.mocked(gateway.videoCreate).mockResolvedValue(
            makeJob({ status: "failed", error: { message: "Content policy violation" } }),
        )

        renderWithClient(<VideoPlayground />)
        vi.useFakeTimers()
        fireEvent.click(screen.getByRole("button", { name: /^generate$/i }))
        await advance(0)

        expect(screen.getByText("Content policy violation")).toBeInTheDocument()
        expect(document.querySelector("video")).not.toBeInTheDocument()
    })

    it("falls back to a generic message when a failed job's error has no message", async () => {
        useModalityStore.getState().patchVideo({ model: "sora-2", prompt: "a cat wizard" })
        // `message` is optional on the wire type — an upstream failure can
        // report just a bare `error: {}` (or omit it under `code` only).
        vi.mocked(gateway.videoCreate).mockResolvedValue(
            makeJob({ status: "failed", error: { code: "content_policy" } }),
        )

        renderWithClient(<VideoPlayground />)
        vi.useFakeTimers()
        fireEvent.click(screen.getByRole("button", { name: /^generate$/i }))
        await advance(0)

        expect(screen.getByText("Video generation failed.")).toBeInTheDocument()
    })

    it("falls back to 0% (rendered as the 2%-minimum bar width) when an in-progress job reports no progress value", async () => {
        useModalityStore.getState().patchVideo({ model: "sora-2", prompt: "a cat wizard" })
        vi.mocked(gateway.videoCreate).mockResolvedValue(
            // `progress` is typed as a required number, but upstream can omit
            // it mid-flight — the `?? 0` fallback (feeding into
            // `Math.max(2, Math.min(100, ...))`) covers that defensively.
            makeJob({ status: "in_progress", progress: undefined as unknown as number }),
        )

        renderWithClient(<VideoPlayground />)
        vi.useFakeTimers()
        fireEvent.click(screen.getByRole("button", { name: /^generate$/i }))
        await advance(0)

        expect(screen.getByText("in_progress")).toBeInTheDocument()
        // The "· N%" metadata text is gated by a strict `!= null` check (a
        // separate condition from the bar's `?? 0`), so it's hidden
        // entirely — only the progress-bar fill (which does use `?? 0`)
        // should reflect the 2%-minimum-clamped fallback width.
        expect(screen.queryByText(/^\d+%$/)).not.toBeInTheDocument()
        const bar = document.querySelector('[style*="width"]') as HTMLElement | null
        expect(bar).toHaveStyle({ width: "2%" })
    })

    it("stopping polling prevents any further videoGet call", async () => {
        useModalityStore.getState().patchVideo({ model: "sora-2", prompt: "a cat wizard" })
        vi.mocked(gateway.videoCreate).mockResolvedValue(makeJob({ status: "queued" }))

        renderWithClient(<VideoPlayground />)
        vi.useFakeTimers()
        fireEvent.click(screen.getByRole("button", { name: /^generate$/i }))
        await advance(0)
        expect(screen.getByRole("button", { name: /stop polling/i })).toBeInTheDocument()

        fireEvent.click(screen.getByRole("button", { name: /stop polling/i }))
        expect(screen.queryByRole("button", { name: /stop polling/i })).not.toBeInTheDocument()

        // The pending sleep(4000) from the (now-cancelled) loop resolves,
        // but must break BEFORE calling videoGet.
        await advance(4000)
        expect(gateway.videoGet).not.toHaveBeenCalled()
    })

    it("a Stop-then-Generate-again sequence does not let the old loop's tail clobber the new run's polling state (abortRef identity)", async () => {
        useModalityStore.getState().patchVideo({ model: "sora-2", prompt: "a cat wizard" })
        vi.mocked(gateway.videoCreate)
            .mockResolvedValueOnce(makeJob({ id: "job-1", status: "queued" }))
            .mockResolvedValueOnce(makeJob({ id: "job-2", status: "queued" }))
        vi.mocked(gateway.videoGet).mockResolvedValue(makeJob({ id: "job-2", status: "in_progress", progress: 40 }))

        renderWithClient(<VideoPlayground />)
        vi.useFakeTimers()

        // Run 1.
        fireEvent.click(screen.getByRole("button", { name: /^generate$/i }))
        await advance(0)
        expect(screen.getByText("job-1")).toBeInTheDocument()
        expect(screen.getByRole("button", { name: /stop polling/i })).toBeInTheDocument()

        // Stop run 1, then immediately start run 2 before run 1's
        // pending sleep(4000) fires.
        fireEvent.click(screen.getByRole("button", { name: /stop polling/i }))
        fireEvent.click(screen.getByRole("button", { name: /^generate$/i }))
        await advance(0)
        expect(screen.getByText("job-2")).toBeInTheDocument()
        expect(screen.getByRole("button", { name: /stop polling/i })).toBeInTheDocument()

        // Both run1's and run2's sleeps are due at the same virtual time.
        // Run1 must wake, see itself cancelled, and break WITHOUT calling
        // videoGet or resetting run2's polling=true.
        await advance(4000)

        expect(gateway.videoGet).toHaveBeenCalledTimes(1)
        expect(gateway.videoGet).toHaveBeenCalledWith("job-2", "sora-2")
        expect(screen.getByRole("button", { name: /stop polling/i })).toBeInTheDocument()
        expect(screen.getByText("job-2")).toBeInTheDocument()
        expect(screen.getByText("in_progress")).toBeInTheDocument()
    })

    it("unmounting during a poll wait prevents any further videoGet call", async () => {
        useModalityStore.getState().patchVideo({ model: "sora-2", prompt: "a cat wizard" })
        vi.mocked(gateway.videoCreate).mockResolvedValue(makeJob({ status: "queued" }))
        vi.mocked(gateway.videoGet).mockResolvedValue(makeJob({ status: "in_progress" }))

        const { unmount } = renderWithClient(<VideoPlayground />)
        vi.useFakeTimers()
        fireEvent.click(screen.getByRole("button", { name: /^generate$/i }))
        await advance(0)

        unmount()
        await advance(20000)
        expect(gateway.videoGet).not.toHaveBeenCalled()
    })

    it("shows an ApiError message via toast.error when job creation fails", async () => {
        const user = userEvent.setup()
        useModalityStore.getState().patchVideo({ model: "sora-2", prompt: "a cat wizard" })
        vi.mocked(gateway.videoCreate).mockRejectedValue(new ApiError("upstream unavailable", 503))
        renderWithClient(<VideoPlayground />)

        await user.click(screen.getByRole("button", { name: /^generate$/i }))
        expect(await screen.findByText("upstream unavailable")).toBeInTheDocument()
        expect(toast.error).toHaveBeenCalledWith("upstream unavailable")
        expect(screen.queryByRole("button", { name: /stop polling/i })).not.toBeInTheDocument()
    })

    it("a polling-time failure (videoGet rejecting) surfaces the error and stops polling", async () => {
        useModalityStore.getState().patchVideo({ model: "sora-2", prompt: "a cat wizard" })
        vi.mocked(gateway.videoCreate).mockResolvedValue(makeJob({ status: "queued" }))
        vi.mocked(gateway.videoGet).mockRejectedValue(new ApiError("job vanished", 404))

        renderWithClient(<VideoPlayground />)
        vi.useFakeTimers()
        fireEvent.click(screen.getByRole("button", { name: /^generate$/i }))
        await advance(0)
        await advance(4000)

        expect(screen.getByText(/Polling failed: job vanished/)).toBeInTheDocument()
        expect(screen.queryByRole("button", { name: /stop polling/i })).not.toBeInTheDocument()
    })

    it("a plain (non-ApiError) Error rejecting job creation still surfaces its message", async () => {
        useModalityStore.getState().patchVideo({ model: "sora-2", prompt: "a cat wizard" })
        vi.mocked(gateway.videoCreate).mockRejectedValue(new Error("network down"))

        renderWithClient(<VideoPlayground />)
        fireEvent.click(screen.getByRole("button", { name: /^generate$/i }))

        expect(await screen.findByText("network down")).toBeInTheDocument()
        expect(toast.error).toHaveBeenCalledWith("network down")
    })

    it("a plain (non-ApiError) Error rejecting videoGet during polling surfaces its message", async () => {
        useModalityStore.getState().patchVideo({ model: "sora-2", prompt: "a cat wizard" })
        vi.mocked(gateway.videoCreate).mockResolvedValue(makeJob({ status: "queued" }))
        vi.mocked(gateway.videoGet).mockRejectedValue(new Error("timed out"))

        renderWithClient(<VideoPlayground />)
        vi.useFakeTimers()
        fireEvent.click(screen.getByRole("button", { name: /^generate$/i }))
        await advance(0)
        await advance(4000)

        expect(screen.getByText(/Polling failed: timed out/)).toBeInTheDocument()
    })

    it("polling gives up after the 10-minute timeout even if the job never reaches a terminal state", async () => {
        useModalityStore.getState().patchVideo({ model: "sora-2", prompt: "a cat wizard" })
        vi.mocked(gateway.videoCreate).mockResolvedValue(makeJob({ status: "queued" }))
        vi.mocked(gateway.videoGet).mockResolvedValue(makeJob({ status: "in_progress", progress: 50 }))

        renderWithClient(<VideoPlayground />)
        vi.useFakeTimers()
        fireEvent.click(screen.getByRole("button", { name: /^generate$/i }))
        await advance(0)

        // Advance well past POLL_TIMEOUT_MS (10 minutes) across several
        // 4s poll ticks so the loop's own elapsed-time check — not a single
        // giant jump — is what trips the timeout guard.
        for (let i = 0; i < 155; i++) {
            await advance(4000)
        }

        expect(
            screen.getByText(/Polling timed out after 10 minutes — check the job manually\./),
        ).toBeInTheDocument()
        expect(screen.queryByRole("button", { name: /stop polling/i })).not.toBeInTheDocument()
    })

    it("clears a stale error after a subsequent successful submission", async () => {
        useModalityStore.getState().patchVideo({ model: "sora-2", prompt: "a cat wizard" })
        vi.mocked(gateway.videoCreate).mockRejectedValueOnce(new ApiError("first failure", 500))

        renderWithClient(<VideoPlayground />)
        vi.useFakeTimers()
        fireEvent.click(screen.getByRole("button", { name: /^generate$/i }))
        await advance(0)
        expect(screen.getByText("first failure")).toBeInTheDocument()

        vi.mocked(gateway.videoCreate).mockResolvedValueOnce(makeJob({ status: "completed" }))
        fireEvent.click(screen.getByRole("button", { name: /^generate$/i }))
        await advance(0)

        expect(screen.queryByText("first failure")).not.toBeInTheDocument()
        expect(screen.getByText("completed")).toBeInTheDocument()
    })
})

describe("VideoPlayground — delete job", () => {
    it("deletes successfully: toasts, clears the job, and shows the empty hint again", async () => {
        const user = userEvent.setup()
        useModalityStore.getState().patchVideo({ model: "sora-2", job: makeJob({ status: "completed" }) })
        vi.mocked(gateway.videoDelete).mockResolvedValue(undefined)
        renderWithClient(<VideoPlayground />)

        await user.click(screen.getByRole("button", { name: /delete/i }))
        await waitFor(() => expect(gateway.videoDelete).toHaveBeenCalledWith("job-1", "sora-2"))
        expect(toast.success).toHaveBeenCalledWith("Video job deleted")
        expect(await screen.findByText(/Loom polls the upstream until it's ready/)).toBeInTheDocument()
        expect(screen.queryByText("job-1")).not.toBeInTheDocument()
    })

    it("a failed delete toasts an error and leaves the job panel in place", async () => {
        const user = userEvent.setup()
        useModalityStore.getState().patchVideo({ model: "sora-2", job: makeJob({ status: "completed" }) })
        vi.mocked(gateway.videoDelete).mockRejectedValue(new ApiError("cannot delete", 409))
        renderWithClient(<VideoPlayground />)

        await user.click(screen.getByRole("button", { name: /delete/i }))
        await waitFor(() => expect(toast.error).toHaveBeenCalledWith("cannot delete"))
        expect(screen.getByText("job-1")).toBeInTheDocument()
    })
})
