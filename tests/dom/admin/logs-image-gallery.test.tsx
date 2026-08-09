import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { ImageGallery } from "@/components/logs/_parts/image-gallery"
import { logDetailImage, logDetailImageUnsafeUrl, logDetailImageEmpty } from "./_fixtures"

describe("ImageGallery", () => {
    it("shows default empty message when no artifacts", () => {
        render(<ImageGallery title="Generated images" colorClass="bg-pink-500" generation={{}} />)
        expect(screen.getByText(/No image artifacts persisted/)).toBeInTheDocument()
    })

    it("shows custom emptyMessage prop", () => {
        render(
            <ImageGallery
                title="Generated images"
                colorClass="bg-pink-500"
                generation={{}}
                emptyMessage="Nothing here!"
            />
        )
        expect(screen.getByText("Nothing here!")).toBeInTheDocument()
    })

    it("renders images from loom_artifacts with '1 image' badge", () => {
        render(
            <ImageGallery
                title="Generated images"
                colorClass="bg-pink-500"
                generation={logDetailImage.generation}
            />
        )
        expect(screen.getByText("1 image")).toBeInTheDocument()
        const imgs = screen.getAllByRole("img")
        expect(imgs.length).toBeGreaterThan(0)
    })

    it("renders 'N images' badge for multiple artifacts", () => {
        const gen = {
            loom_artifacts: [
                { index: 0, url: "/api/logs/generations/abc/artifacts/0", mime: "image/png", bytes: 1000 },
                { index: 1, url: "/api/logs/generations/abc/artifacts/1", mime: "image/png", bytes: 2000 },
            ],
        }
        render(<ImageGallery title="Generated images" colorClass="bg-pink-500" generation={gen} />)
        expect(screen.getByText("2 images")).toBeInTheDocument()
    })

    it("falls back to data[] entries with loom_artifact:true", () => {
        const gen = {
            data: [
                { loom_artifact: true, url: "/api/logs/generations/abc/artifacts/0", mime: "image/jpeg", bytes: 5000 },
            ],
        }
        render(<ImageGallery title="Generated images" colorClass="bg-pink-500" generation={gen} />)
        expect(screen.getAllByRole("img").length).toBe(1)
    })

    it("XSS guard: does NOT render img for javascript: URL", () => {
        // Security: isSafeArtifactUrl must reject javascript: scheme
        render(
            <ImageGallery
                title="Generated images"
                colorClass="bg-pink-500"
                generation={logDetailImageUnsafeUrl.generation}
            />
        )
        // No images should render — the unsafe URL must be filtered
        expect(screen.queryAllByRole("img")).toHaveLength(0)
        // Empty state should show instead
        expect(screen.getByText(/No image artifacts persisted/)).toBeInTheDocument()
    })

    it("shows bytes as 'N B' for small files", () => {
        const gen = {
            loom_artifacts: [
                { index: 0, url: "/api/logs/generations/abc/artifacts/0", mime: "image/png", bytes: 500 },
            ],
        }
        render(<ImageGallery title="T" colorClass="bg-pink-500" generation={gen} />)
        expect(screen.getByText(/500 B/)).toBeInTheDocument()
    })

    it("shows bytes as 'X.X KB' for medium files", () => {
        const gen = {
            loom_artifacts: [
                { index: 0, url: "/api/logs/generations/abc/artifacts/0", mime: "image/png", bytes: 5000 },
            ],
        }
        render(<ImageGallery title="T" colorClass="bg-pink-500" generation={gen} />)
        expect(screen.getByText(/KB/)).toBeInTheDocument()
    })

    it("shows bytes as 'X.XX MB' for large files", () => {
        const gen = {
            loom_artifacts: [
                { index: 0, url: "/api/logs/generations/abc/artifacts/0", mime: "image/png", bytes: 5_000_000 },
            ],
        }
        render(<ImageGallery title="T" colorClass="bg-pink-500" generation={gen} />)
        expect(screen.getByText(/MB/)).toBeInTheDocument()
    })

    it("renders revised_prompt when present", () => {
        const gen = {
            data: [
                {
                    loom_artifact: true,
                    url: "/api/logs/generations/abc/artifacts/0",
                    mime: "image/png",
                    bytes: 1000,
                    revised_prompt: "A cat astronaut in space",
                },
            ],
        }
        render(<ImageGallery title="T" colorClass="bg-pink-500" generation={gen} />)
        expect(screen.getByText(/A cat astronaut in space/)).toBeInTheDocument()
    })

    it("download link has correct href and download attribute", () => {
        render(
            <ImageGallery
                title="Generated images"
                colorClass="bg-pink-500"
                generation={logDetailImage.generation}
            />
        )
        const link = document.querySelector("a[download]") as HTMLAnchorElement
        expect(link).toBeTruthy()
        expect(link.href).toContain("/api/logs/generations/")
    })

    it("renders no size suffix when artifact has no bytes (covers fmtBytes null branch)", () => {
        // Artifact with no bytes → fmtBytes(undefined) → null → size falsy → empty string suffix
        const gen = {
            loom_artifacts: [
                { index: 0, url: "/api/logs/generations/abc/artifacts/0", mime: "image/png" },
                // no bytes field
            ],
        }
        render(<ImageGallery title="T" colorClass="bg-pink-500" generation={gen} />)
        // Image should still render (URL is safe)
        expect(screen.getAllByRole("img").length).toBeGreaterThan(0)
        // No KB/MB/B suffix in the figcaption since size is null
        expect(screen.queryByText(/\d+ B/)).toBeNull()
        expect(screen.queryByText(/KB/)).toBeNull()
    })

    it("uses entry bytes from data[] when artifact has no bytes (covers a.bytes ?? entry.bytes)", () => {
        // loom_artifacts entry has no bytes, but data[] entry has bytes
        const gen = {
            loom_artifacts: [
                { index: 0, url: "/api/logs/generations/abc/artifacts/0", mime: "image/png" },
            ],
            data: [
                { url: "/api/logs/generations/abc/artifacts/0", mime: "image/png", bytes: 512 },
            ],
        }
        render(<ImageGallery title="T" colorClass="bg-pink-500" generation={gen} />)
        expect(screen.getByText(/512 B/)).toBeInTheDocument()
    })

    it("uses entry mime from data[] when artifact has no mime (covers a.mime ?? entry.mime)", () => {
        // loom_artifacts entry has no mime, but data[] entry has mime
        const gen = {
            loom_artifacts: [
                { index: 0, url: "/api/logs/generations/abc/artifacts/0" },
            ],
            data: [
                { url: "/api/logs/generations/abc/artifacts/0", mime: "image/webp", bytes: 1000 },
            ],
        }
        render(<ImageGallery title="T" colorClass="bg-pink-500" generation={gen} />)
        // mime from entry should appear in figcaption
        expect(screen.getByText(/image\/webp/)).toBeInTheDocument()
    })

    it("falls back to image/* when neither artifact nor entry has mime", () => {
        // No mime anywhere → "image/*" fallback
        const gen = {
            loom_artifacts: [
                { index: 0, url: "/api/logs/generations/abc/artifacts/0" },
                // no mime
            ],
            // no data[]
        }
        render(<ImageGallery title="T" colorClass="bg-pink-500" generation={gen} />)
        expect(screen.getByText(/image\/\*/)).toBeInTheDocument()
    })

    it("renders title text", () => {
        render(<ImageGallery title="Generated images" colorClass="bg-pink-500" generation={{}} />)
        expect(screen.getByText("Generated images")).toBeInTheDocument()
    })

    it("shows empty state for logDetailImageEmpty", () => {
        render(
            <ImageGallery
                title="Generated images"
                colorClass="bg-pink-500"
                generation={logDetailImageEmpty.generation}
            />
        )
        expect(screen.getByText(/No image artifacts persisted/)).toBeInTheDocument()
    })

    it("shows 200 KB for 204800 bytes artifact", () => {
        render(
            <ImageGallery
                title="Generated images"
                colorClass="bg-pink-500"
                generation={logDetailImage.generation}
            />
        )
        // fmtBytes uses toFixed(1) for KB: 204800 / 1024 = 200.0 → "200.0 KB"
        expect(screen.getByText(/200\.0 KB/)).toBeInTheDocument()
    })
})
