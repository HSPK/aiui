import * as React from "react"
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest"
import { screen, waitFor, fireEvent, act, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { ImagePlayground } from "@/components/playground/image/image-playground"
import { useModalityStore } from "@/lib/stores/modality-store"
import { gateway } from "@/lib/api/gateway"
import type { ImageGenerationResponse } from "@/lib/api/gateway"
import { ApiError } from "@/lib/api/client"
import { toast } from "sonner"
import { renderWithClient, resetModalityStore } from "../../_render"
import { makeModel } from "../_fixtures"

vi.mock("@/lib/api/gateway", () => ({
    gateway: {
        imageGenerate: vi.fn(),
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

const IMAGE_MODELS = [
    makeModel({ id: "i1", name: "dall-e-3", model_id: "dall-e-3", type: "image" }),
    makeModel({ id: "i2", name: "gpt-image-1", model_id: "gpt-image-1", type: "image" }),
    makeModel({ id: "i3", name: "dall-e-2", model_id: "dall-e-2", type: "image" }),
    makeModel({ id: "i4", name: "stable-diffusion-xl", model_id: "stable-diffusion-xl", type: "image" }),
]

function twoImageResult(overrides: Partial<ImageGenerationResponse> = {}): ImageGenerationResponse {
    return {
        created: 1700000000,
        data: [
            { url: "https://cdn.example.com/img0.png", revised_prompt: "a revised, more vivid prompt" },
            { b64_json: "ZmFrZWJhc2U2NA==" },
        ],
        usage: { input_tokens: 5, output_tokens: 10, total_tokens: 15 },
        ...overrides,
    }
}

beforeEach(() => {
    useListMock.mockReturnValue({ data: IMAGE_MODELS, isLoading: false })
})

afterEach(() => {
    resetModalityStore()
})

async function pickModel(
    user: ReturnType<typeof userEvent.setup>,
    currentTriggerName: RegExp,
    modelName: string,
) {
    await user.click(screen.getByRole("button", { name: currentTriggerName }))
    await user.click(await screen.findByText(modelName))
}

async function openParams(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: /params/i }))
}

describe("ImagePlayground — empty state", () => {
    it("shows a generic empty hint and sample prompt chips before any model is picked", () => {
        renderWithClient(<ImagePlayground />)
        expect(screen.getByText("Pick a model and write a prompt to begin.")).toBeInTheDocument()
        expect(screen.getByText(/vivid oil painting of a fox/)).toBeInTheDocument()
    })

    it("switches to the 'tap a sample' hint once a model is picked", async () => {
        const user = userEvent.setup()
        renderWithClient(<ImagePlayground />)
        await pickModel(user, /select a model/i, "dall-e-3")
        expect(screen.getByText("Tap a sample below or write your own prompt.")).toBeInTheDocument()
    })

    it("clicking a prompt chip fills the prompt textarea", async () => {
        const user = userEvent.setup()
        renderWithClient(<ImagePlayground />)
        await user.click(screen.getByText("Isometric pixel-art coffee shop at dawn, warm lighting"))
        expect(
            screen.getByDisplayValue("Isometric pixel-art coffee shop at dawn, warm lighting"),
        ).toBeInTheDocument()
    })

    it("typing directly into the prompt textarea updates its value", async () => {
        const user = userEvent.setup()
        renderWithClient(<ImagePlayground />)
        await user.type(screen.getByLabelText("Prompt"), "a hand-typed prompt")
        expect(screen.getByDisplayValue("a hand-typed prompt")).toBeInTheDocument()
    })
})

describe("ImagePlayground — family-conditional params popover", () => {
    it("shows every field for a generic/unrecognised model family", async () => {
        const user = userEvent.setup()
        renderWithClient(<ImagePlayground />)
        await openParams(user)
        expect(screen.getByText("Style")).toBeInTheDocument()
        expect(screen.getByText("Response format")).toBeInTheDocument()
        expect(screen.getByText("Output format")).toBeInTheDocument()
        expect(screen.getByText("Background")).toBeInTheDocument()
        expect(screen.getByText(/^Quality$/)).toBeInTheDocument()
    })

    async function selectRowOption(user: ReturnType<typeof userEvent.setup>, rowLabel: string | RegExp, optionName: string) {
        const row = screen.getByText(rowLabel).closest("div")!
        await user.click(within(row).getByRole("combobox"))
        await user.click(await screen.findByRole("option", { name: optionName }))
    }

    it("Size/Quality/Style/Response format/Output format/Background selects update params with a concrete value, then clear back to undefined via Default", async () => {
        const user = userEvent.setup()
        renderWithClient(<ImagePlayground />)
        await openParams(user)

        await selectRowOption(user, "Size", "1792x1024")
        expect(useModalityStore.getState().image.params.size).toBe("1792x1024")
        await selectRowOption(user, "Size", "Default")
        expect(useModalityStore.getState().image.params.size).toBeUndefined()

        await selectRowOption(user, /^Quality$/, "hd")
        expect(useModalityStore.getState().image.params.quality).toBe("hd")
        await selectRowOption(user, /^Quality$/, "Default")
        expect(useModalityStore.getState().image.params.quality).toBeUndefined()

        await selectRowOption(user, "Style", "natural")
        expect(useModalityStore.getState().image.params.style).toBe("natural")
        await selectRowOption(user, "Style", "Default")
        expect(useModalityStore.getState().image.params.style).toBeUndefined()

        await selectRowOption(user, "Response format", "b64_json")
        expect(useModalityStore.getState().image.params.response_format).toBe("b64_json")
        await selectRowOption(user, "Response format", "Default")
        expect(useModalityStore.getState().image.params.response_format).toBeUndefined()

        await selectRowOption(user, "Output format", "webp")
        expect(useModalityStore.getState().image.params.output_format).toBe("webp")
        await selectRowOption(user, "Output format", "Default")
        expect(useModalityStore.getState().image.params.output_format).toBeUndefined()

        await selectRowOption(user, "Background", "transparent")
        expect(useModalityStore.getState().image.params.background).toBe("transparent")
        await selectRowOption(user, "Background", "Default")
        expect(useModalityStore.getState().image.params.background).toBeUndefined()
    })

    it("hides output_format/background but shows style/response_format for dall-e-3", async () => {
        const user = userEvent.setup()
        renderWithClient(<ImagePlayground />)
        await pickModel(user, /select a model/i, "dall-e-3")
        await openParams(user)
        expect(screen.getByText("Style")).toBeInTheDocument()
        expect(screen.getByText("Response format")).toBeInTheDocument()
        expect(screen.queryByText("Output format")).not.toBeInTheDocument()
        expect(screen.queryByText("Background")).not.toBeInTheDocument()
    })

    it("hides style/response_format but shows output_format/background for gpt-image-1", async () => {
        const user = userEvent.setup()
        renderWithClient(<ImagePlayground />)
        await pickModel(user, /select a model/i, "gpt-image-1")
        await openParams(user)
        expect(screen.getByText("Output format")).toBeInTheDocument()
        expect(screen.getByText("Background")).toBeInTheDocument()
        expect(screen.queryByText("Style")).not.toBeInTheDocument()
        expect(screen.queryByText("Response format")).not.toBeInTheDocument()
    })

    it("hides the Quality row entirely for dall-e-2 (empty qualities list)", async () => {
        const user = userEvent.setup()
        renderWithClient(<ImagePlayground />)
        await pickModel(user, /select a model/i, "dall-e-2")
        await openParams(user)
        expect(screen.queryByText(/^Quality$/)).not.toBeInTheDocument()
        expect(screen.getByText("Response format")).toBeInTheDocument()
        expect(screen.queryByText("Style")).not.toBeInTheDocument()
    })

    it("Reset restores the fixed DEFAULTS ({n: 1}), not an empty object", async () => {
        const user = userEvent.setup()
        renderWithClient(<ImagePlayground />)
        await openParams(user)
        const nInput = screen.getByRole("spinbutton")
        fireEvent.change(nInput, { target: { value: "3" } })
        expect(screen.getByText(/Generate · 3 images/)).toBeInTheDocument()

        await user.click(screen.getByRole("button", { name: /reset/i }))
        expect(screen.getByText(/Generate · 1 image(?!s)/)).toBeInTheDocument()
    })
})

describe("ImagePlayground — N clamps per family but the underlying value is preserved", () => {
    it("clamps n down to the family's maxN and restores it when switching back to a generic model", async () => {
        const user = userEvent.setup()
        useModalityStore.getState().patchImage({ params: { n: 4 } })
        renderWithClient(<ImagePlayground />)
        expect(screen.getByText(/Generate · 4 images/)).toBeInTheDocument()

        await pickModel(user, /select a model/i, "dall-e-3")
        expect(screen.getByText(/Generate · 1 image(?!s)/)).toBeInTheDocument()

        await pickModel(user, /dall-e-3/i, "stable-diffusion-xl")
        expect(screen.getByText(/Generate · 4 images/)).toBeInTheDocument()
    })

    // Regression test for a bug found while testing (image-playground.tsx,
    // the `setParams` callback): `ParamsPopover` is handed `sanitised` (the
    // family-filtered view) as its `value`, and its `onChange` always sends
    // back the FULL sanitised shape plus one changed key (never a bare
    // single-field diff). `setParams` used to write that straight into the
    // store's `params`, replacing it outright — so the "switching families
    // preserves hidden values" guarantee (the file's own doc comment above
    // `sanitised`) only held if the user never edited *any* popover field
    // while a restrictive family was active. Editing one field (even an
    // unrelated one, like N) silently discarded every *other* field the
    // current family hides, because the write-back replaced the full
    // params with the filtered view instead of merging into it. Fixed by
    // merging `v` onto the full `params` instead of replacing it.
    it(
        "editing an unrelated field while restricted preserves a hidden sibling field",
        async () => {
            const user = userEvent.setup()
            useModalityStore.getState().patchImage({ params: { n: 1, style: "vivid" } })
            renderWithClient(<ImagePlayground />)

            // dall-e-2 hides `style` from the popover.
            await pickModel(user, /select a model/i, "dall-e-2")

            // Edit an unrelated, always-visible field. A single explicit
            // `fireEvent.change` (rather than `user.clear` + `user.type`)
            // avoids an intermediate empty-string commit that would
            // round-trip through the input's own `|| 1` fallback and then
            // have "2" appended onto it.
            await openParams(user)
            const nInput = screen.getByRole("spinbutton")
            fireEvent.change(nInput, { target: { value: "2" } })

            // Switch back to a family that allows `style`.
            await pickModel(user, /dall-e-2/i, "stable-diffusion-xl")

            await openParams(user)
            const styleRow = screen.getByText("Style").closest("div")!
            expect(within(styleRow).getByRole("combobox")).toHaveTextContent("vivid")
            // ...and the unrelated edit itself actually landed.
            expect(useModalityStore.getState().image.params.n).toBe(2)
        },
    )
})

describe("ImagePlayground — validation toasts (⌘/Ctrl+Enter bypasses the disabled button)", () => {
    it("toasts when no model is picked", () => {
        useModalityStore.getState().patchImage({ prompt: "a cat" })
        renderWithClient(<ImagePlayground />)
        fireEvent.keyDown(screen.getByPlaceholderText(/vivid oil painting/), {
            key: "Enter",
            ctrlKey: true,
        })
        expect(toast.error).toHaveBeenCalledWith("Pick an image model")
    })

    it("toasts when the prompt is empty", () => {
        useModalityStore.getState().patchImage({ model: "dall-e-3" })
        renderWithClient(<ImagePlayground />)
        fireEvent.keyDown(screen.getByPlaceholderText(/vivid oil painting/), {
            key: "Enter",
            ctrlKey: true,
        })
        expect(toast.error).toHaveBeenCalledWith("Prompt is required")
    })
})

describe("ImagePlayground — submit flow", () => {
    it("strips family-disallowed fields but keeps allowed ones in the gateway call", async () => {
        const user = userEvent.setup()
        useModalityStore.getState().patchImage({
            model: "dall-e-3",
            prompt: "a fox by a fireplace",
            params: { n: 1, output_format: "jpeg", background: "opaque", style: "vivid" },
        })
        vi.mocked(gateway.imageGenerate).mockResolvedValue(twoImageResult())
        renderWithClient(<ImagePlayground />)

        await user.click(screen.getByRole("button", { name: /^generate/i }))

        await waitFor(() => expect(gateway.imageGenerate).toHaveBeenCalledTimes(1))
        const body = vi.mocked(gateway.imageGenerate).mock.calls[0][0]
        expect(body.model).toBe("dall-e-3")
        expect(body.prompt).toBe("a fox by a fireplace")
        expect(body.style).toBe("vivid") // dall-e-3 allows style
        expect(body).not.toHaveProperty("output_format") // dall-e-3 rejects it
        expect(body).not.toHaveProperty("background") // dall-e-3 rejects it
    })

    it("trims the prompt before sending", async () => {
        const user = userEvent.setup()
        useModalityStore.getState().patchImage({ model: "dall-e-3", prompt: "  padded prompt  " })
        vi.mocked(gateway.imageGenerate).mockResolvedValue(twoImageResult())
        renderWithClient(<ImagePlayground />)
        await user.click(screen.getByRole("button", { name: /^generate/i }))
        await waitFor(() =>
            expect(gateway.imageGenerate).toHaveBeenCalledWith(
                expect.objectContaining({ prompt: "padded prompt" }),
            ),
        )
    })

    it("renders the result grid with images, a token count, and revised-prompt caption", async () => {
        const user = userEvent.setup()
        useModalityStore.getState().patchImage({ model: "dall-e-3", prompt: "a fox" })
        vi.mocked(gateway.imageGenerate).mockResolvedValue(twoImageResult())
        renderWithClient(<ImagePlayground />)

        await user.click(screen.getByRole("button", { name: /^generate/i }))

        expect(await screen.findByText(/2 images/)).toBeInTheDocument()
        expect(screen.getByText(/15 tokens/)).toBeInTheDocument()
        expect(screen.getByText(/a revised, more vivid prompt/)).toBeInTheDocument()
        const images = screen.getAllByRole("img")
        expect(images.length).toBeGreaterThanOrEqual(2)
    })

    it("'Use ↑' applies the revised prompt back into the textarea and toasts success", async () => {
        const user = userEvent.setup()
        useModalityStore.getState().patchImage({ model: "dall-e-3", prompt: "a fox" })
        vi.mocked(gateway.imageGenerate).mockResolvedValue(twoImageResult())
        renderWithClient(<ImagePlayground />)
        await user.click(screen.getByRole("button", { name: /^generate/i }))
        await screen.findByText(/2 images/)

        await user.click(screen.getByRole("button", { name: /use ↑/i }))
        expect(screen.getByDisplayValue("a revised, more vivid prompt")).toBeInTheDocument()
        expect(toast.success).toHaveBeenCalledWith("Prompt updated to revised version")
    })

    it("opens a lightbox dialog with the enlarged image and closes on Escape", async () => {
        const user = userEvent.setup()
        useModalityStore.getState().patchImage({ model: "dall-e-3", prompt: "a fox" })
        vi.mocked(gateway.imageGenerate).mockResolvedValue(twoImageResult())
        renderWithClient(<ImagePlayground />)
        await user.click(screen.getByRole("button", { name: /^generate/i }))
        await screen.findByText(/2 images/)

        await user.click(screen.getByRole("button", { name: "Enlarge image 1" }))
        const dialog = await screen.findByRole("dialog")
        expect(within(dialog).getByRole("img")).toBeInTheDocument()

        await user.keyboard("{Escape}")
        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    })

    it("lightbox falls back to 'Image N' alt text for an entry with no revised_prompt", async () => {
        const user = userEvent.setup()
        useModalityStore.getState().patchImage({ model: "dall-e-3", prompt: "a fox" })
        vi.mocked(gateway.imageGenerate).mockResolvedValue(twoImageResult())
        renderWithClient(<ImagePlayground />)
        await user.click(screen.getByRole("button", { name: /^generate/i }))
        await screen.findByText(/2 images/)

        // The second image (b64_json) fixture has no revised_prompt.
        await user.click(screen.getByRole("button", { name: "Enlarge image 2" }))
        const dialog = await screen.findByRole("dialog")
        expect(within(dialog).getByAltText("Image 2")).toBeInTheDocument()
    })

    it("renders '2 images' (counting a raw entry with neither url nor b64_json) but skips rendering it, and honours webp output_format for the download extension", async () => {
        const user = userEvent.setup()
        useModalityStore.getState().patchImage({
            model: "gpt-image-1",
            prompt: "a fox",
            params: { n: 1, output_format: "webp" },
        })
        vi.mocked(gateway.imageGenerate).mockResolvedValue({
            created: 123,
            data: [
                { url: "https://cdn.example.com/only.png" },
                {}, // Neither url nor b64_json — must be silently skipped.
            ],
        })
        renderWithClient(<ImagePlayground />)
        await user.click(screen.getByRole("button", { name: /^generate/i }))

        expect(await screen.findByText(/^2 images/)).toBeInTheDocument()
        // Only the valid entry renders a figure/img; the empty entry is skipped.
        expect(screen.getAllByRole("img")).toHaveLength(1)
        const downloadLink = screen.getByRole("link", { name: /download/i })
        expect(downloadLink).toHaveAttribute("download", expect.stringMatching(/\.webp$/))
    })

    it("shows 'Upstream returned no images.' when data is empty", async () => {
        const user = userEvent.setup()
        useModalityStore.getState().patchImage({ model: "dall-e-3", prompt: "a fox" })
        vi.mocked(gateway.imageGenerate).mockResolvedValue({ data: [] })
        renderWithClient(<ImagePlayground />)
        await user.click(screen.getByRole("button", { name: /^generate/i }))
        expect(await screen.findByText("Upstream returned no images.")).toBeInTheDocument()
    })

    it("renders '1 image' (singular) for a single-item result", async () => {
        const user = userEvent.setup()
        useModalityStore.getState().patchImage({ model: "dall-e-3", prompt: "a fox" })
        vi.mocked(gateway.imageGenerate).mockResolvedValue({
            data: [{ url: "https://cdn.example.com/only.png" }],
        })
        renderWithClient(<ImagePlayground />)
        await user.click(screen.getByRole("button", { name: /^generate/i }))
        expect(await screen.findByText(/^1 image(?!s)/)).toBeInTheDocument()
    })

    it("shows a disabled SkeletonGrid-driven loading state sized to sanitised.n while in flight", async () => {
        const user = userEvent.setup()
        useModalityStore.getState().patchImage({
            model: "dall-e-3", // maxN=1, but let's use a model that allows a higher n
            prompt: "a fox",
            params: { n: 1 },
        })
        // Switch to a generic model so n isn't clamped to 1, to make the
        // skeleton-count assertion meaningful.
        useModalityStore.getState().patchImage({ model: "stable-diffusion-xl", params: { n: 2 } })
        let resolvePromise!: (v: ImageGenerationResponse) => void
        vi.mocked(gateway.imageGenerate).mockImplementation(
            () => new Promise((resolve) => { resolvePromise = resolve }),
        )
        const { container } = renderWithClient(<ImagePlayground />)

        await user.click(screen.getByRole("button", { name: /^generate/i }))
        const runningButton = await screen.findByRole("button", { name: /generating…/i })
        expect(runningButton).toBeDisabled()
        expect(container.querySelectorAll(".animate-pulse")).toHaveLength(2)

        await act(async () => {
            resolvePromise(twoImageResult())
        })
        expect(await screen.findByText("tap to enlarge")).toBeInTheDocument()
        expect(screen.getAllByRole("img")).toHaveLength(2)
    })

    it("shows the ApiError message via toast.error and an error card on failure", async () => {
        const user = userEvent.setup()
        useModalityStore.getState().patchImage({ model: "dall-e-3", prompt: "a fox" })
        vi.mocked(gateway.imageGenerate).mockRejectedValue(new ApiError("quota exceeded", 429))
        renderWithClient(<ImagePlayground />)
        await user.click(screen.getByRole("button", { name: /^generate/i }))
        expect(await screen.findByText("quota exceeded")).toBeInTheDocument()
        expect(toast.error).toHaveBeenCalledWith("quota exceeded")
    })

    it("shows a plain Error's message (not just ApiError/string rejections)", async () => {
        const user = userEvent.setup()
        useModalityStore.getState().patchImage({ model: "dall-e-3", prompt: "a fox" })
        vi.mocked(gateway.imageGenerate).mockRejectedValue(new Error("network exploded"))
        renderWithClient(<ImagePlayground />)
        await user.click(screen.getByRole("button", { name: /^generate/i }))
        expect(await screen.findByText("network exploded")).toBeInTheDocument()
        expect(toast.error).toHaveBeenCalledWith("network exploded")
    })

    it("clears a stale error after a subsequent successful submission", async () => {
        const user = userEvent.setup()
        useModalityStore.getState().patchImage({ model: "dall-e-3", prompt: "a fox" })
        vi.mocked(gateway.imageGenerate).mockRejectedValueOnce(new ApiError("first failure", 500))
        renderWithClient(<ImagePlayground />)

        await user.click(screen.getByRole("button", { name: /^generate/i }))
        expect(await screen.findByText("first failure")).toBeInTheDocument()

        vi.mocked(gateway.imageGenerate).mockResolvedValueOnce(twoImageResult())
        await user.click(screen.getByRole("button", { name: /^generate/i }))

        await waitFor(() => expect(screen.queryByText("first failure")).not.toBeInTheDocument())
        expect(await screen.findByText(/2 images/)).toBeInTheDocument()
    })
})
