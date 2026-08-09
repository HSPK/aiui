import { describe, expect, it } from "vitest";
import {
    textPartSchema,
    imageUrlPartSchema,
    filePartSchema,
    toolCallPartSchema,
    toolResultPartSchema,
    contentPartSchema,
    messageContentSchema,
    extractText,
    hasAttachments,
    TOOL_CONTENT_BUDGET_BYTES,
    TOOL_CONTENT_MARKER_RESERVE_BYTES,
} from "@/lib/schemas/content";
import type { MessageContent } from "@/lib/schemas/content";

describe("textPartSchema", () => {
    it("accepts a plain text part", () => {
        expect(textPartSchema.safeParse({ type: "text", text: "hello" }).success).toBe(true);
    });

    it("rejects text exceeding 1,000,000 bytes", () => {
        const result = textPartSchema.safeParse({ type: "text", text: "a".repeat(1_000_001) });
        expect(result.success).toBe(false);
    });

    it("accepts text at exactly the byte boundary", () => {
        const result = textPartSchema.safeParse({ type: "text", text: "a".repeat(1_000_000) });
        expect(result.success).toBe(true);
    });

    it("rejects a mismatched discriminant", () => {
        expect(textPartSchema.safeParse({ type: "image_url", text: "hi" }).success).toBe(false);
    });
});

describe("imageUrlPartSchema", () => {
    it("accepts a minimal image_url part", () => {
        const result = imageUrlPartSchema.safeParse({
            type: "image_url",
            image_url: { url: "data:image/png;base64,AAAA" },
        });
        expect(result.success).toBe(true);
    });

    it.each(["auto", "low", "high"])("accepts detail=%s", (detail) => {
        const result = imageUrlPartSchema.safeParse({
            type: "image_url",
            image_url: { url: "https://example.com/x.png", detail },
        });
        expect(result.success).toBe(true);
    });

    it("rejects an invalid detail value", () => {
        const result = imageUrlPartSchema.safeParse({
            type: "image_url",
            image_url: { url: "https://example.com/x.png", detail: "ultra" },
        });
        expect(result.success).toBe(false);
    });

    it("rejects a url exceeding 50,000,000 bytes", () => {
        const result = imageUrlPartSchema.safeParse({
            type: "image_url",
            image_url: { url: "a".repeat(50_000_001) },
        });
        expect(result.success).toBe(false);
    });
});

describe("filePartSchema", () => {
    it("accepts a minimal file part", () => {
        const result = filePartSchema.safeParse({
            type: "file",
            file: { filename: "doc.pdf", file_data: "data:application/pdf;base64,AAAA" },
        });
        expect(result.success).toBe(true);
    });

    it("accepts an optional mime_type", () => {
        const result = filePartSchema.safeParse({
            type: "file",
            file: { filename: "doc.pdf", file_data: "data:x;base64,AA", mime_type: "application/pdf" },
        });
        expect(result.success).toBe(true);
    });

    it("rejects a filename over 512 characters", () => {
        const result = filePartSchema.safeParse({
            type: "file",
            file: { filename: "a".repeat(513), file_data: "data:x;base64,AA" },
        });
        expect(result.success).toBe(false);
    });

    it("rejects file_data exceeding the inline data byte cap", () => {
        const result = filePartSchema.safeParse({
            type: "file",
            file: { filename: "doc.pdf", file_data: "a".repeat(50_000_001) },
        });
        expect(result.success).toBe(false);
    });

    it("rejects a mime_type over 200 characters", () => {
        const result = filePartSchema.safeParse({
            type: "file",
            file: { filename: "doc.pdf", file_data: "AA", mime_type: "a".repeat(201) },
        });
        expect(result.success).toBe(false);
    });
});

describe("toolCallPartSchema", () => {
    it("accepts a minimal tool_call part", () => {
        const result = toolCallPartSchema.safeParse({
            type: "tool_call",
            tool_call: { id: "call-1", name: "search", arguments: "{}" },
        });
        expect(result.success).toBe(true);
    });

    it("accepts an optional source label", () => {
        const result = toolCallPartSchema.safeParse({
            type: "tool_call",
            tool_call: { id: "call-1", name: "search", arguments: "{}", source: "github · search_repositories" },
        });
        expect(result.success).toBe(true);
    });

    it("rejects a missing arguments field", () => {
        const result = toolCallPartSchema.safeParse({
            type: "tool_call",
            tool_call: { id: "call-1", name: "search" },
        });
        expect(result.success).toBe(false);
    });
});

describe("toolResultPartSchema", () => {
    it("accepts a minimal tool_result part", () => {
        const result = toolResultPartSchema.safeParse({
            type: "tool_result",
            tool_result: { tool_call_id: "call-1", content: "42" },
        });
        expect(result.success).toBe(true);
    });

    it("accepts is_error and source", () => {
        const result = toolResultPartSchema.safeParse({
            type: "tool_result",
            tool_result: { tool_call_id: "call-1", content: "boom", is_error: true, source: "github", name: "search" },
        });
        expect(result.success).toBe(true);
    });

    it("rejects content exceeding TOOL_CONTENT_BUDGET_BYTES", () => {
        const result = toolResultPartSchema.safeParse({
            type: "tool_result",
            tool_result: { tool_call_id: "call-1", content: "a".repeat(TOOL_CONTENT_BUDGET_BYTES + 1) },
        });
        expect(result.success).toBe(false);
    });

    it("accepts content at exactly TOOL_CONTENT_BUDGET_BYTES", () => {
        const result = toolResultPartSchema.safeParse({
            type: "tool_result",
            tool_result: { tool_call_id: "call-1", content: "a".repeat(TOOL_CONTENT_BUDGET_BYTES) },
        });
        expect(result.success).toBe(true);
    });

    it("exposes a marker reserve smaller than the total budget", () => {
        expect(TOOL_CONTENT_MARKER_RESERVE_BYTES).toBeLessThan(TOOL_CONTENT_BUDGET_BYTES);
        expect(TOOL_CONTENT_MARKER_RESERVE_BYTES).toBe(64);
        expect(TOOL_CONTENT_BUDGET_BYTES).toBe(256 * 1024);
    });
});

describe("contentPartSchema (discriminated union)", () => {
    it.each([
        { type: "text", text: "hi" },
        { type: "image_url", image_url: { url: "https://x.com/a.png" } },
        { type: "file", file: { filename: "a.pdf", file_data: "AA" } },
        { type: "tool_call", tool_call: { id: "1", name: "t", arguments: "{}" } },
        { type: "tool_result", tool_result: { tool_call_id: "1", content: "ok" } },
    ])("accepts a valid $type part", (part) => {
        expect(contentPartSchema.safeParse(part).success).toBe(true);
    });

    it("rejects an unknown discriminant", () => {
        const result = contentPartSchema.safeParse({ type: "video", url: "https://x.com/v.mp4" });
        expect(result.success).toBe(false);
    });

    it("rejects a part missing its type discriminant", () => {
        expect(contentPartSchema.safeParse({ text: "hi" }).success).toBe(false);
    });
});

describe("messageContentSchema", () => {
    it("accepts a bare string", () => {
        expect(messageContentSchema.safeParse("hello").success).toBe(true);
    });

    it("accepts an array of content parts", () => {
        const result = messageContentSchema.safeParse([
            { type: "text", text: "hello" },
            { type: "image_url", image_url: { url: "https://x.com/a.png" } },
        ]);
        expect(result.success).toBe(true);
    });

    it("accepts an empty array", () => {
        expect(messageContentSchema.safeParse([]).success).toBe(true);
    });

    it("rejects a plain object (neither string nor array)", () => {
        expect(messageContentSchema.safeParse({ type: "text", text: "hi" }).success).toBe(false);
    });

    it("rejects an array containing an invalid part", () => {
        const result = messageContentSchema.safeParse([{ type: "text" }]);
        expect(result.success).toBe(false);
    });
});

describe("extractText", () => {
    it("returns the string as-is for plain-text content", () => {
        expect(extractText("hello world")).toBe("hello world");
    });

    it("joins only the text parts of an array, in order", () => {
        const content: MessageContent = [
            { type: "text", text: "first" },
            { type: "image_url", image_url: { url: "https://x.com/a.png" } },
            { type: "text", text: "second" },
        ];
        expect(extractText(content)).toBe("first\nsecond");
    });

    it("returns an empty string when there are no text parts", () => {
        const content: MessageContent = [{ type: "image_url", image_url: { url: "https://x.com/a.png" } }];
        expect(extractText(content)).toBe("");
    });

    it("returns an empty string for an empty array", () => {
        expect(extractText([])).toBe("");
    });

    it("filters out empty-string text parts via Boolean filter", () => {
        const content: MessageContent = [
            { type: "text", text: "" },
            { type: "text", text: "kept" },
        ];
        expect(extractText(content)).toBe("kept");
    });

    it("returns an empty string for a non-string, non-array value", () => {
        expect(extractText(42 as unknown as MessageContent)).toBe("");
    });
});

describe("hasAttachments", () => {
    it("returns false for plain string content", () => {
        expect(hasAttachments("hello")).toBe(false);
    });

    it("returns false when every part is text", () => {
        const content: MessageContent = [
            { type: "text", text: "a" },
            { type: "text", text: "b" },
        ];
        expect(hasAttachments(content)).toBe(false);
    });

    it("returns true when at least one non-text part is present", () => {
        const content: MessageContent = [
            { type: "text", text: "a" },
            { type: "image_url", image_url: { url: "https://x.com/a.png" } },
        ];
        expect(hasAttachments(content)).toBe(true);
    });

    it("returns false for an empty array", () => {
        expect(hasAttachments([])).toBe(false);
    });

    it("returns false for a non-string, non-array value", () => {
        expect(hasAttachments(42 as unknown as MessageContent)).toBe(false);
    });
});
