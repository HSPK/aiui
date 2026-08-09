import { describe, expect, it } from "vitest";
import { capabilityDTOSchema } from "@/lib/schemas/capability";

describe("capabilityDTOSchema", () => {
    it("parses a complete, valid capability descriptor", () => {
        const input = {
            id: "chat",
            label: "Chat",
            description: "Conversational chat completions",
            default_variant: "chat.completions",
        };
        const result = capabilityDTOSchema.parse(input);
        expect(result).toEqual(input);
    });

    it("accepts a null description", () => {
        const result = capabilityDTOSchema.safeParse({
            id: "embedding",
            label: "Embedding",
            description: null,
            default_variant: "embeddings",
        });
        expect(result.success).toBe(true);
    });

    it("rejects a missing description (not optional, must be null or string)", () => {
        const result = capabilityDTOSchema.safeParse({
            id: "embedding",
            label: "Embedding",
            default_variant: "embeddings",
        });
        expect(result.success).toBe(false);
    });

    it("rejects when required string fields are missing", () => {
        const result = capabilityDTOSchema.safeParse({ id: "chat" });
        expect(result.success).toBe(false);
        if (!result.success) {
            const paths = result.error.issues.map((i) => i.path.join("."));
            expect(paths).toEqual(expect.arrayContaining(["label", "description", "default_variant"]));
        }
    });

    it("rejects non-string id", () => {
        const result = capabilityDTOSchema.safeParse({
            id: 123,
            label: "Chat",
            description: null,
            default_variant: "chat.completions",
        });
        expect(result.success).toBe(false);
    });
});
