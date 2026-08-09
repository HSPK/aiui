import { describe, expect, it } from "vitest";
import { toolDTOSchema, toolCreateSchema, toolUpdateSchema } from "@/lib/schemas/tool";

describe("toolDTOSchema", () => {
    const valid = {
        id: "tool-1",
        name: "search_repositories",
        description: "Search repos",
        parameters: { type: "object", properties: {} },
        webhook_url: null,
        enabled: true,
        created_at: "2024-01-01T00:00:00.000Z",
        updated_at: "2024-01-01T00:00:00.000Z",
    };

    it("parses a valid tool DTO", () => {
        expect(toolDTOSchema.parse(valid)).toEqual(valid);
    });

    it("accepts a non-null webhook_url", () => {
        const result = toolDTOSchema.safeParse({ ...valid, webhook_url: "https://example.com/hook" });
        expect(result.success).toBe(true);
    });

    it("rejects a missing webhook_url (must be explicit null)", () => {
        const { webhook_url, ...rest } = valid;
        const result = toolDTOSchema.safeParse(rest);
        expect(result.success).toBe(false);
    });
});

describe("toolCreateSchema", () => {
    it("accepts a minimal valid name", () => {
        const result = toolCreateSchema.safeParse({ name: "my_tool" });
        expect(result.success).toBe(true);
    });

    it("trims the name", () => {
        const result = toolCreateSchema.safeParse({ name: "  my_tool  " });
        expect(result.success).toBe(true);
        if (result.success) expect(result.data.name).toBe("my_tool");
    });

    it("rejects an empty name", () => {
        const result = toolCreateSchema.safeParse({ name: "" });
        expect(result.success).toBe(false);
        if (!result.success) expect(result.error.issues[0].message).toBe("Tool name is required");
    });

    it("rejects a name with disallowed characters", () => {
        const result = toolCreateSchema.safeParse({ name: "my tool!" });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues[0].message).toBe("Only letters, digits, _ and - allowed");
        }
    });

    it("accepts letters, digits, underscore and hyphen", () => {
        const result = toolCreateSchema.safeParse({ name: "Tool-123_abc" });
        expect(result.success).toBe(true);
    });

    it("accepts optional description and parameters", () => {
        const result = toolCreateSchema.safeParse({
            name: "t",
            description: "desc",
            parameters: { type: "object" },
        });
        expect(result.success).toBe(true);
    });

    it("accepts a null webhook_url", () => {
        const result = toolCreateSchema.safeParse({ name: "t", webhook_url: null });
        expect(result.success).toBe(true);
    });

    it("rejects a non-URL webhook_url", () => {
        const result = toolCreateSchema.safeParse({ name: "t", webhook_url: "not-a-url" });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues.some((i) => i.message === "webhook_url must be a URL")).toBe(true);
        }
    });

    it("accepts an omitted enabled flag", () => {
        const result = toolCreateSchema.safeParse({ name: "t" });
        expect(result.success).toBe(true);
        if (result.success) expect(result.data.enabled).toBeUndefined();
    });
});

describe("toolUpdateSchema", () => {
    it("accepts an empty object (all fields optional)", () => {
        const result = toolUpdateSchema.safeParse({});
        expect(result.success).toBe(true);
    });

    it("still validates the name pattern when provided", () => {
        const result = toolUpdateSchema.safeParse({ name: "bad name!" });
        expect(result.success).toBe(false);
    });

    it("accepts a partial update with only enabled", () => {
        const result = toolUpdateSchema.safeParse({ enabled: false });
        expect(result.success).toBe(true);
    });
});
