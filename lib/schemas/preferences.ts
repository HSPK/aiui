import { z } from "zod";

/**
 * Cross-device user preferences — stored server-side and fetched per session.
 * Device-only UI preferences (sendOnEnter, showTimestamps, compactMode) live
 * in localStorage via lib/stores/device-settings-store.ts and are NOT here.
 */

export const userPreferencesDTOSchema = z.object({
    // Default models for chat & title generation.
    default_model: z.string(),
    default_summary_model: z.string(),

    // Default generation parameters (apply when the per-tab override is unset).
    default_system_prompt: z.string(),
    /** undefined → use upstream model default. */
    default_temperature: z.number().nullable(),
    default_max_tokens: z.number().int().positive(),
    default_history_limit: z.number().int().positive(),

    // Display profile.
    user_name: z.string(),
    user_avatar: z.string(),
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
    user_name: "User",
    user_avatar: "👤",
};

export type UserPreferencesDTO = z.infer<typeof userPreferencesDTOSchema>;
export type UserPreferencesUpdateInput = z.infer<typeof userPreferencesUpdateSchema>;
