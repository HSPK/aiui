import { describe, expect, it } from "vitest";
import { variantDescriptorSchema } from "@/lib/schemas/variant";

describe("variantDescriptorSchema", () => {
    it("parses a complete, valid variant descriptor", () => {
        const input = {
            id: "chat.completions",
            capability: "chat",
            path: "/v1/chat/completions",
            supports_streaming: true,
        };
        expect(variantDescriptorSchema.parse(input)).toEqual(input);
    });

    it("accepts supports_streaming: false", () => {
        const result = variantDescriptorSchema.safeParse({
            id: "embeddings",
            capability: "embedding",
            path: "/v1/embeddings",
            supports_streaming: false,
        });
        expect(result.success).toBe(true);
    });

    it("rejects a missing required field", () => {
        const result = variantDescriptorSchema.safeParse({
            id: "chat.completions",
            capability: "chat",
            path: "/v1/chat/completions",
        });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues.some((i) => i.path.join(".") === "supports_streaming")).toBe(true);
        }
    });

    it("rejects a non-boolean supports_streaming", () => {
        const result = variantDescriptorSchema.safeParse({
            id: "chat.completions",
            capability: "chat",
            path: "/v1/chat/completions",
            supports_streaming: "true",
        });
        expect(result.success).toBe(false);
    });
});
