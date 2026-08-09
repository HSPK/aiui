import { describe, it, expect } from "vitest";
import { capabilityLabel } from "@/components/providers/capability-label";

describe("capabilityLabel", () => {
    it("returns '—' for null", () => expect(capabilityLabel(null)).toBe("—"));
    it("returns '—' for undefined", () => expect(capabilityLabel(undefined)).toBe("—"));
    it("returns '—' for empty string", () => expect(capabilityLabel("")).toBe("—"));
    it("returns Chat for chat", () => expect(capabilityLabel("chat")).toBe("Chat"));
    it("returns Embedding for embedding", () => expect(capabilityLabel("embedding")).toBe("Embedding"));
    it("returns Image for image", () => expect(capabilityLabel("image")).toBe("Image"));
    it("returns Speech for audio.speech", () => expect(capabilityLabel("audio.speech")).toBe("Speech"));
    it("returns Transcription for audio.transcription", () => expect(capabilityLabel("audio.transcription")).toBe("Transcription"));
    it("returns Rerank for rerank", () => expect(capabilityLabel("rerank")).toBe("Rerank"));
    it("title-cases last segment of unknown dotted id", () =>
        expect(capabilityLabel("audio.custom_thing")).toBe("Custom Thing"));
    it("handles hyphens in unknown dotted id", () =>
        expect(capabilityLabel("audio.my-mod")).toBe("My Mod"));
    it("title-cases unknown non-dotted id", () =>
        expect(capabilityLabel("vision")).toBe("Vision"));
    it("title-cases unknown non-dotted id with underscore", () =>
        expect(capabilityLabel("image_gen")).toBe("Image Gen"));
});
