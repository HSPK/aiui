import { describe, expect, it } from "vitest";
import { logStatusSchema, logListItemDTOSchema, logDetailDTOSchema, logListQuerySchema } from "@/lib/schemas/log";

const baseListItem = {
    id: "log-1",
    user_id: "user-1",
    username: "alice",
    model_name: "gpt-4o-mini",
    capability: "chat",
    input_summary: "hello",
    status: "completed" as const,
    input: "hello",
    output: "hi",
    reason: null,
    created_at: "2024-01-01T00:00:00.000Z",
    updated_at: "2024-01-01T00:00:00.000Z",
    is_deleted: false,
};

describe("logStatusSchema", () => {
    it.each(["pending", "completed", "failed"])("accepts %s", (status) => {
        expect(logStatusSchema.safeParse(status).success).toBe(true);
    });

    it("rejects an unknown status", () => {
        expect(logStatusSchema.safeParse("cancelled").success).toBe(false);
    });
});

describe("logListItemDTOSchema", () => {
    it("parses a valid, minimal list item", () => {
        const result = logListItemDTOSchema.safeParse(baseListItem);
        expect(result.success).toBe(true);
    });

    it("allows username / capability / input_summary / reason to be null", () => {
        const result = logListItemDTOSchema.safeParse(baseListItem);
        expect(result.success).toBe(true);
    });

    it("accepts optional numeric token/latency fields", () => {
        const result = logListItemDTOSchema.safeParse({
            ...baseListItem,
            prompt_tokens: 10,
            completion_tokens: 20,
            total_tokens: 30,
            first_token_latency_ms: 100,
            total_latency_ms: 500,
        });
        expect(result.success).toBe(true);
    });

    it("accepts null for the optional numeric fields", () => {
        const result = logListItemDTOSchema.safeParse({
            ...baseListItem,
            prompt_tokens: null,
            first_token_latency_ms: null,
        });
        expect(result.success).toBe(true);
    });

    it("rejects an invalid status", () => {
        const result = logListItemDTOSchema.safeParse({ ...baseListItem, status: "unknown" });
        expect(result.success).toBe(false);
    });

    it("rejects when username is undefined instead of null", () => {
        const { username, ...rest } = baseListItem;
        const result = logListItemDTOSchema.safeParse(rest);
        expect(result.success).toBe(false);
    });

    it("rejects a non-integer prompt_tokens", () => {
        const result = logListItemDTOSchema.safeParse({ ...baseListItem, prompt_tokens: 1.5 });
        expect(result.success).toBe(false);
    });
});

describe("logDetailDTOSchema", () => {
    it("extends the list item with unknown input + kwargs/generation records", () => {
        const result = logDetailDTOSchema.safeParse({
            ...baseListItem,
            input: { messages: [{ role: "user", content: "hi" }] },
            generation_kwargs: { temperature: 0.7 },
            generation: { id: "gen-1" },
        });
        expect(result.success).toBe(true);
    });

    it("accepts a null generation", () => {
        const result = logDetailDTOSchema.safeParse({
            ...baseListItem,
            input: {},
            generation_kwargs: {},
            generation: null,
        });
        expect(result.success).toBe(true);
    });

    it("accepts optional conversation_id / message_id", () => {
        const result = logDetailDTOSchema.safeParse({
            ...baseListItem,
            input: {},
            generation_kwargs: {},
            generation: null,
            conversation_id: "conv-1",
            message_id: "msg-1",
        });
        expect(result.success).toBe(true);
    });

    it("rejects when generation_kwargs is missing", () => {
        const { generation_kwargs, ...rest } = {
            ...baseListItem,
            input: {},
            generation_kwargs: {},
            generation: null,
        };
        const result = logDetailDTOSchema.safeParse(rest);
        expect(result.success).toBe(false);
    });

    it("allows input to be any unknown value (e.g. a raw string)", () => {
        const result = logDetailDTOSchema.safeParse({
            ...baseListItem,
            input: "raw string body",
            generation_kwargs: {},
            generation: null,
        });
        expect(result.success).toBe(true);
    });
});

describe("logListQuerySchema", () => {
    it("applies all defaults", () => {
        const result = logListQuerySchema.parse({});
        expect(result).toEqual({ page: 1, page_size: 20, sort: "-created_at" });
    });

    it("trims filter strings", () => {
        const result = logListQuerySchema.parse({
            user_id: "  u1  ",
            model_name: "  gpt  ",
            capability: "  chat  ",
        });
        expect(result.user_id).toBe("u1");
        expect(result.model_name).toBe("gpt");
        expect(result.capability).toBe("chat");
    });

    it("accepts a valid status filter", () => {
        const result = logListQuerySchema.safeParse({ status: "failed" });
        expect(result.success).toBe(true);
    });

    it("rejects an invalid status filter", () => {
        const result = logListQuerySchema.safeParse({ status: "bogus" });
        expect(result.success).toBe(false);
    });

    it("rejects page_size above 500", () => {
        expect(logListQuerySchema.safeParse({ page_size: 501 }).success).toBe(false);
    });
});
