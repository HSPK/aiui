import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Each of these pages is a 1-line wrapper around a heavy playground
// component (components/playground/**, out of app/** scope). Stub each
// component so the test exercises only the page's own composition
// (default export renders the right child, nothing more).
vi.mock("@/components/playground/audio-speech/speech-playground", () => ({
    SpeechPlayground: () => <div data-testid="speech-playground" />,
}));
vi.mock("@/components/playground/audio-transcription/transcription-playground", () => ({
    TranscriptionPlayground: () => <div data-testid="transcription-playground" />,
}));
vi.mock("@/components/playground/embedding/embedding-playground", () => ({
    EmbeddingPlayground: () => <div data-testid="embedding-playground" />,
}));
vi.mock("@/components/playground/image/image-playground", () => ({
    ImagePlayground: () => <div data-testid="image-playground" />,
}));
vi.mock("@/components/playground/playground-hub", () => ({
    PlaygroundHub: () => <div data-testid="playground-hub" />,
}));
vi.mock("@/components/playground/video/video-playground", () => ({
    VideoPlayground: () => <div data-testid="video-playground" />,
}));

import SpeechPlaygroundPage from "@/app/(dashboard)/playground/audio/speech/page";
import TranscriptionPlaygroundPage from "@/app/(dashboard)/playground/audio/transcription/page";
import EmbeddingPlaygroundPage from "@/app/(dashboard)/playground/embedding/page";
import ImagePlaygroundPage from "@/app/(dashboard)/playground/image/page";
import PlaygroundPage from "@/app/(dashboard)/playground/page";
import VideoPlaygroundPage from "@/app/(dashboard)/playground/video/page";

describe("Thin playground modality page wrappers", () => {
    it("SpeechPlaygroundPage renders SpeechPlayground", () => {
        render(<SpeechPlaygroundPage />);
        expect(screen.getByTestId("speech-playground")).toBeInTheDocument();
    });

    it("TranscriptionPlaygroundPage renders TranscriptionPlayground", () => {
        render(<TranscriptionPlaygroundPage />);
        expect(screen.getByTestId("transcription-playground")).toBeInTheDocument();
    });

    it("EmbeddingPlaygroundPage renders EmbeddingPlayground", () => {
        render(<EmbeddingPlaygroundPage />);
        expect(screen.getByTestId("embedding-playground")).toBeInTheDocument();
    });

    it("ImagePlaygroundPage renders ImagePlayground", () => {
        render(<ImagePlaygroundPage />);
        expect(screen.getByTestId("image-playground")).toBeInTheDocument();
    });

    it("PlaygroundPage renders PlaygroundHub", () => {
        render(<PlaygroundPage />);
        expect(screen.getByTestId("playground-hub")).toBeInTheDocument();
    });

    it("VideoPlaygroundPage renders VideoPlayground", () => {
        render(<VideoPlaygroundPage />);
        expect(screen.getByTestId("video-playground")).toBeInTheDocument();
    });
});
