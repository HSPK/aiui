import { describe, expect, it } from "vitest";
import {
    statsTrendPointSchema,
    statsBucketSchema,
    statsModelTrendPointSchema,
    statsOverviewSchema,
    statsModelTrendDetailSchema,
    modelStatsDTOSchema,
    statsQuerySchema,
} from "@/lib/schemas/stats";

describe("statsTrendPointSchema", () => {
    it("parses a valid trend point", () => {
        const result = statsTrendPointSchema.safeParse({
            day: "2024-01-01",
            requests: 10,
            prompt_tokens: 100,
            completion_tokens: 200,
            total_tokens: 300,
            failed: 1,
        });
        expect(result.success).toBe(true);
    });

    it("rejects a non-integer requests count", () => {
        const result = statsTrendPointSchema.safeParse({
            day: "2024-01-01",
            requests: 1.5,
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
            failed: 0,
        });
        expect(result.success).toBe(false);
    });
});

describe("statsBucketSchema", () => {
    it("parses a valid bucket", () => {
        const result = statsBucketSchema.safeParse({ key: "chat", label: "Chat", requests: 5, total_tokens: 500 });
        expect(result.success).toBe(true);
    });

    it("rejects a missing key", () => {
        expect(statsBucketSchema.safeParse({ label: "Chat", requests: 5, total_tokens: 500 }).success).toBe(false);
    });
});

describe("statsModelTrendPointSchema", () => {
    it("parses a valid per-model trend point", () => {
        const result = statsModelTrendPointSchema.safeParse({ day: "2024-01-01", model: "gpt-4o", requests: 3 });
        expect(result.success).toBe(true);
    });
});

const totals = {
    requests: 10,
    completed: 8,
    failed: 1,
    pending: 1,
    prompt_tokens: 100,
    completion_tokens: 200,
    total_tokens: 300,
    avg_first_token_latency_ms: 120,
    avg_total_latency_ms: 900,
};

describe("statsOverviewSchema", () => {
    const valid = {
        window_start: "2024-01-01",
        window_end: "2024-01-14",
        days: 14,
        totals,
        trend: [],
        trend_by_model: [],
        trend_models: [],
        by_capability: [],
        by_model: [],
    };

    it("parses a full valid overview", () => {
        expect(statsOverviewSchema.safeParse(valid).success).toBe(true);
    });

    it("allows avg latency fields to be null", () => {
        const result = statsOverviewSchema.safeParse({
            ...valid,
            totals: { ...totals, avg_first_token_latency_ms: null, avg_total_latency_ms: null },
        });
        expect(result.success).toBe(true);
    });

    it("rejects days <= 0", () => {
        expect(statsOverviewSchema.safeParse({ ...valid, days: 0 }).success).toBe(false);
    });

    it("rejects a non-array trend", () => {
        expect(statsOverviewSchema.safeParse({ ...valid, trend: "none" }).success).toBe(false);
    });

    it("validates nested trend point entries", () => {
        const result = statsOverviewSchema.safeParse({
            ...valid,
            trend: [{ day: "2024-01-01", requests: "10", prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, failed: 0 }],
        });
        expect(result.success).toBe(false);
    });
});

describe("statsModelTrendDetailSchema", () => {
    it("parses a valid per-model trend detail row", () => {
        const result = statsModelTrendDetailSchema.safeParse({
            day: "2024-01-01",
            requests: 5,
            failed: 0,
            prompt_tokens: 10,
            completion_tokens: 20,
            total_tokens: 30,
            avg_first_token_latency_ms: null,
            avg_total_latency_ms: 400,
        });
        expect(result.success).toBe(true);
    });
});

describe("modelStatsDTOSchema", () => {
    const valid = {
        model_name: "gpt-4o-mini",
        provider: "openai",
        capability: "chat",
        description: null,
        context_window: 128000,
        max_tokens: 4096,
        window_start: "2024-01-01",
        window_end: "2024-01-14",
        days: 14,
        totals,
        trend: [],
    };

    it("parses a valid model stats DTO", () => {
        expect(modelStatsDTOSchema.safeParse(valid).success).toBe(true);
    });

    it("allows provider / capability / description to be null (deleted model)", () => {
        const result = modelStatsDTOSchema.safeParse({
            ...valid,
            provider: null,
            capability: null,
            description: null,
        });
        expect(result.success).toBe(true);
    });

    it("rejects a non-positive days value", () => {
        expect(modelStatsDTOSchema.safeParse({ ...valid, days: -1 }).success).toBe(false);
    });
});

describe("statsQuerySchema", () => {
    it("defaults days to 14 when omitted", () => {
        const result = statsQuerySchema.parse({});
        expect(result.days).toBe(14);
        expect(result.user_id).toBeUndefined();
    });

    it("coerces days from a string", () => {
        const result = statsQuerySchema.parse({ days: "30" });
        expect(result.days).toBe(30);
    });

    it("rejects days below 1", () => {
        expect(statsQuerySchema.safeParse({ days: 0 }).success).toBe(false);
    });

    it("rejects days above 90", () => {
        expect(statsQuerySchema.safeParse({ days: 91 }).success).toBe(false);
    });

    it("accepts days at the 90 boundary", () => {
        expect(statsQuerySchema.safeParse({ days: 90 }).success).toBe(true);
    });

    it("trims an optional user_id filter", () => {
        const result = statsQuerySchema.parse({ user_id: "  u1  " });
        expect(result.user_id).toBe("u1");
    });
});
