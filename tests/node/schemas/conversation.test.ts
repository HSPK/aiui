import { describe, expect, it } from "vitest";
import {
    messageRoleSchema,
    conversationDTOSchema,
    messageDTOSchema,
    conversationListQuerySchema,
    conversationTitleSchema,
    messageListQuerySchema,
    messageRatingSchema,
} from "@/lib/schemas/conversation";

describe("messageRoleSchema", () => {
    it.each(["user", "assistant", "system", "tool"])("accepts %s", (role) => {
        expect(messageRoleSchema.safeParse(role).success).toBe(true);
    });

    it("rejects an unknown role", () => {
        expect(messageRoleSchema.safeParse("moderator").success).toBe(false);
    });
});

describe("conversationDTOSchema", () => {
    const valid = {
        id: "conv-1",
        user_id: "user-1",
        title: "New Chat",
        config: { model: "gpt-4o" },
        created_at: "2024-01-01T00:00:00.000Z",
        updated_at: "2024-01-01T00:00:00.000Z",
        is_deleted: false,
    };

    it("parses a valid conversation without group_id", () => {
        expect(conversationDTOSchema.safeParse(valid).success).toBe(true);
    });

    it("accepts an optional group_id", () => {
        expect(conversationDTOSchema.safeParse({ ...valid, group_id: "grp-1" }).success).toBe(true);
    });

    it("accepts an empty config record", () => {
        expect(conversationDTOSchema.safeParse({ ...valid, config: {} }).success).toBe(true);
    });

    it("rejects a non-boolean is_deleted", () => {
        expect(conversationDTOSchema.safeParse({ ...valid, is_deleted: "false" }).success).toBe(false);
    });

    it("rejects a non-record config", () => {
        expect(conversationDTOSchema.safeParse({ ...valid, config: "not-an-object" }).success).toBe(false);
    });
});

describe("messageDTOSchema", () => {
    const valid = {
        id: "msg-1",
        conversation_id: "conv-1",
        role: "user" as const,
        content: "hello",
        is_active: true,
        created_at: "2024-01-01T00:00:00.000Z",
    };

    it("parses a minimal, valid message", () => {
        expect(messageDTOSchema.safeParse(valid).success).toBe(true);
    });

    it("allows content to be any unknown shape (array of parts)", () => {
        const result = messageDTOSchema.safeParse({
            ...valid,
            content: [{ type: "text", text: "hi" }],
        });
        expect(result.success).toBe(true);
    });

    it("accepts all optional fields when present", () => {
        const result = messageDTOSchema.safeParse({
            ...valid,
            reasoning_content: "because...",
            model_id: "model-1",
            generation_id: "gen-1",
            parent_id: "msg-0",
            rating: "up",
            feedback: "great",
            error: "boom",
        });
        expect(result.success).toBe(true);
    });

    it("rejects an invalid rating value", () => {
        const result = messageDTOSchema.safeParse({ ...valid, rating: "meh" });
        expect(result.success).toBe(false);
    });

    it("rejects an invalid role", () => {
        const result = messageDTOSchema.safeParse({ ...valid, role: "narrator" });
        expect(result.success).toBe(false);
    });

    it("rejects a missing is_active", () => {
        const { is_active, ...rest } = valid;
        expect(messageDTOSchema.safeParse(rest).success).toBe(false);
    });
});

describe("conversationListQuerySchema", () => {
    it("applies all defaults", () => {
        const result = conversationListQuerySchema.parse({});
        expect(result).toEqual({ page: 1, page_size: 20, sort: "-updated_at" });
    });

    it("rejects page_size above 200", () => {
        expect(conversationListQuerySchema.safeParse({ page_size: 201 }).success).toBe(false);
    });

    it("trims the keyword", () => {
        const result = conversationListQuerySchema.parse({ keyword: "  hi  " });
        expect(result.keyword).toBe("hi");
    });
});

describe("conversationTitleSchema", () => {
    it("trims and accepts a valid title", () => {
        const result = conversationTitleSchema.safeParse({ title: "  My Chat  " });
        expect(result.success).toBe(true);
        if (result.success) expect(result.data.title).toBe("My Chat");
    });

    it("rejects an empty title", () => {
        const result = conversationTitleSchema.safeParse({ title: "" });
        expect(result.success).toBe(false);
        if (!result.success) expect(result.error.issues[0].message).toBe("title is required");
    });

    it("rejects a title over 200 characters", () => {
        const result = conversationTitleSchema.safeParse({ title: "a".repeat(201) });
        expect(result.success).toBe(false);
    });

    it("accepts a title at the 200-character boundary", () => {
        const result = conversationTitleSchema.safeParse({ title: "a".repeat(200) });
        expect(result.success).toBe(true);
    });

    it("accepts an optional expected_title for compare-and-swap", () => {
        const result = conversationTitleSchema.safeParse({ title: "New", expected_title: "Old" });
        expect(result.success).toBe(true);
    });
});

describe("messageListQuerySchema", () => {
    it("applies all defaults", () => {
        const result = messageListQuerySchema.parse({});
        expect(result).toEqual({ page: 1, page_size: 50, sort: "-created_at" });
    });

    it("rejects page_size above 500", () => {
        expect(messageListQuerySchema.safeParse({ page_size: 501 }).success).toBe(false);
    });
});

describe("messageRatingSchema", () => {
    it.each(["up", "down", "none"])("accepts rating=%s", (rating) => {
        expect(messageRatingSchema.safeParse({ rating }).success).toBe(true);
    });

    it("rejects an invalid rating", () => {
        expect(messageRatingSchema.safeParse({ rating: "meh" }).success).toBe(false);
    });

    it("accepts a null feedback", () => {
        expect(messageRatingSchema.safeParse({ rating: "up", feedback: null }).success).toBe(true);
    });

    it("accepts an omitted feedback", () => {
        expect(messageRatingSchema.safeParse({ rating: "none" }).success).toBe(true);
    });
});
