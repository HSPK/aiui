import { z } from "zod";

/**
 * Cross-device user preferences — stored server-side and fetched per session.
 * Device-only UI preferences (sendOnEnter, showTimestamps, compactMode) live
 * in localStorage via lib/stores/device-settings-store.ts and are NOT here.
 */

export const userPreferencesDTOSchema = z.object({
    default_model: z.string(),
    default_summary_model: z.string(),

    default_system_prompt: z.string(),
    /** undefined → use upstream model default. */
    default_temperature: z.number().nullable(),
    default_max_tokens: z.number().int().positive(),
    default_history_limit: z.number().int().positive(),

    user_name: z.string(),
    user_avatar: z.string(),

    // Appearance — drives lib/themes registry + next-themes scheme.
    theme_id: z.string(),
    theme_scheme: z.enum(["light", "dark", "system"]),

    // Chat rendering.
    chat_render_mode: z.enum(["instant", "stream", "typewriter"]),
    typewriter_cps: z.number().int().min(20).max(400),
    chat_bubble_style: z.enum(["plain", "bubble", "minimal"]),
});

/** All fields optional → PATCH semantics. Sent fields replace; unsent stay. */
export const userPreferencesUpdateSchema = userPreferencesDTOSchema.partial();

export const defaultUserPreferences: UserPreferencesDTO = {
    default_model: "",
    default_summary_model: "",
    default_system_prompt: "You are a helpful assistant.",
    default_temperature: null,
    default_max_tokens: 4096,
    default_history_limit: 10,
    user_name: "",
    user_avatar: "👤",
    theme_id: "default",
    theme_scheme: "system",
    chat_render_mode: "stream",
    typewriter_cps: 80,
    chat_bubble_style: "plain",
};

export type UserPreferencesDTO = z.infer<typeof userPreferencesDTOSchema>;
export type UserPreferencesUpdateInput = z.infer<typeof userPreferencesUpdateSchema>;
