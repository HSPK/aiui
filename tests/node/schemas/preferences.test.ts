import { describe, expect, it } from "vitest";
import {
    userPreferencesDTOSchema,
    userPreferencesUpdateSchema,
    defaultUserPreferences,
} from "@/lib/schemas/preferences";

describe("defaultUserPreferences", () => {
    it("is itself a valid userPreferencesDTOSchema payload", () => {
        const result = userPreferencesDTOSchema.safeParse(defaultUserPreferences);
        expect(result.success).toBe(true);
    });

    it("has the documented default values", () => {
        expect(defaultUserPreferences).toEqual({
            default_model: "",
            default_summary_model: "",
            default_system_prompt: "You are a helpful assistant.",
            default_history_limit: 10,
            user_name: "",
            user_avatar: "👤",
            theme_id: "default",
            theme_scheme: "system",
            chat_render_mode: "stream",
            typewriter_cps: 80,
            chat_bubble_style: "plain",
            gateway_timeout_seconds: 3600,
            mcp_connect_timeout_seconds: 3600,
            mcp_auto_check_interval_minutes: 0,
            provider_auto_check_interval_minutes: 0,
        });
    });
});

describe("userPreferencesDTOSchema", () => {
    it("rejects a default_system_prompt over 20,000 characters", () => {
        const result = userPreferencesDTOSchema.safeParse({
            ...defaultUserPreferences,
            default_system_prompt: "a".repeat(20_001),
        });
        expect(result.success).toBe(false);
    });

    it("accepts a default_system_prompt at the 20,000-character boundary", () => {
        const result = userPreferencesDTOSchema.safeParse({
            ...defaultUserPreferences,
            default_system_prompt: "a".repeat(20_000),
        });
        expect(result.success).toBe(true);
    });

    it("rejects default_history_limit below 1", () => {
        const result = userPreferencesDTOSchema.safeParse({ ...defaultUserPreferences, default_history_limit: 0 });
        expect(result.success).toBe(false);
    });

    it("rejects default_history_limit above 50", () => {
        const result = userPreferencesDTOSchema.safeParse({ ...defaultUserPreferences, default_history_limit: 51 });
        expect(result.success).toBe(false);
    });

    it("rejects user_name over 120 characters", () => {
        const result = userPreferencesDTOSchema.safeParse({
            ...defaultUserPreferences,
            user_name: "a".repeat(121),
        });
        expect(result.success).toBe(false);
    });

    it("rejects user_avatar over 20 characters", () => {
        const result = userPreferencesDTOSchema.safeParse({
            ...defaultUserPreferences,
            user_avatar: "a".repeat(21),
        });
        expect(result.success).toBe(false);
    });

    it.each(["light", "dark", "system"])("accepts theme_scheme=%s", (theme_scheme) => {
        expect(userPreferencesDTOSchema.safeParse({ ...defaultUserPreferences, theme_scheme }).success).toBe(true);
    });

    it("rejects an invalid theme_scheme", () => {
        const result = userPreferencesDTOSchema.safeParse({ ...defaultUserPreferences, theme_scheme: "auto" });
        expect(result.success).toBe(false);
    });

    it.each(["instant", "stream", "typewriter"])("accepts chat_render_mode=%s", (chat_render_mode) => {
        expect(userPreferencesDTOSchema.safeParse({ ...defaultUserPreferences, chat_render_mode }).success).toBe(
            true,
        );
    });

    it("rejects an invalid chat_render_mode", () => {
        const result = userPreferencesDTOSchema.safeParse({ ...defaultUserPreferences, chat_render_mode: "batch" });
        expect(result.success).toBe(false);
    });

    it("rejects typewriter_cps below 20", () => {
        expect(
            userPreferencesDTOSchema.safeParse({ ...defaultUserPreferences, typewriter_cps: 19 }).success,
        ).toBe(false);
    });

    it("rejects typewriter_cps above 400", () => {
        expect(
            userPreferencesDTOSchema.safeParse({ ...defaultUserPreferences, typewriter_cps: 401 }).success,
        ).toBe(false);
    });

    it("accepts typewriter_cps at the 20 and 400 boundaries", () => {
        expect(userPreferencesDTOSchema.safeParse({ ...defaultUserPreferences, typewriter_cps: 20 }).success).toBe(
            true,
        );
        expect(userPreferencesDTOSchema.safeParse({ ...defaultUserPreferences, typewriter_cps: 400 }).success).toBe(
            true,
        );
    });

    it.each(["plain", "bubble", "minimal"])("accepts chat_bubble_style=%s", (chat_bubble_style) => {
        expect(
            userPreferencesDTOSchema.safeParse({ ...defaultUserPreferences, chat_bubble_style }).success,
        ).toBe(true);
    });

    it("rejects gateway_timeout_seconds of 0 (must be >= 1)", () => {
        expect(
            userPreferencesDTOSchema.safeParse({ ...defaultUserPreferences, gateway_timeout_seconds: 0 }).success,
        ).toBe(false);
    });

    it("rejects gateway_timeout_seconds above 86,400", () => {
        expect(
            userPreferencesDTOSchema.safeParse({ ...defaultUserPreferences, gateway_timeout_seconds: 86_401 })
                .success,
        ).toBe(false);
    });

    it("accepts mcp_connect_timeout_seconds at the 86,400 boundary", () => {
        expect(
            userPreferencesDTOSchema.safeParse({ ...defaultUserPreferences, mcp_connect_timeout_seconds: 86_400 })
                .success,
        ).toBe(true);
    });

    it("accepts an auto-check interval of 0 (disabled)", () => {
        const result = userPreferencesDTOSchema.safeParse({
            ...defaultUserPreferences,
            mcp_auto_check_interval_minutes: 0,
            provider_auto_check_interval_minutes: 0,
        });
        expect(result.success).toBe(true);
    });

    it("rejects an auto-check interval above 1440", () => {
        expect(
            userPreferencesDTOSchema.safeParse({
                ...defaultUserPreferences,
                mcp_auto_check_interval_minutes: 1441,
            }).success,
        ).toBe(false);
    });

    it("rejects a missing required field", () => {
        const { default_model, ...rest } = defaultUserPreferences;
        expect(userPreferencesDTOSchema.safeParse(rest).success).toBe(false);
    });
});

describe("userPreferencesUpdateSchema", () => {
    it("accepts an empty object (PATCH semantics)", () => {
        expect(userPreferencesUpdateSchema.safeParse({}).success).toBe(true);
    });

    it("accepts a single-field partial update", () => {
        const result = userPreferencesUpdateSchema.safeParse({ theme_scheme: "dark" });
        expect(result.success).toBe(true);
        if (result.success) expect(result.data).toEqual({ theme_scheme: "dark" });
    });

    it("still validates the field's constraints when present", () => {
        expect(userPreferencesUpdateSchema.safeParse({ typewriter_cps: 1000 }).success).toBe(false);
    });

    it("rejects an unrelated invalid enum value even in partial form", () => {
        expect(userPreferencesUpdateSchema.safeParse({ chat_bubble_style: "fancy" }).success).toBe(false);
    });
});
