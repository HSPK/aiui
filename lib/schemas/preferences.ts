import { z } from "zod";

/**
 * Cross-device user preferences — stored server-side and fetched per session.
 * Device-only UI preferences (sendOnEnter, showTimestamps, compactMode) live
 * in localStorage via lib/stores/device-settings-store.ts and are NOT here.
 */

export const userPreferencesDTOSchema = z.object({
    default_model: z.string(),
    default_summary_model: z.string(),

    default_system_prompt: z.string().max(20_000),
    default_history_limit: z.number().int().min(1).max(50),

    user_name: z.string().max(120),
    user_avatar: z.string().max(20),

    // Appearance — drives lib/themes registry + next-themes scheme.
    theme_id: z.string(),
    theme_scheme: z.enum(["light", "dark", "system"]),

    // Chat rendering.
    chat_render_mode: z.enum(["instant", "stream", "typewriter"]),
    typewriter_cps: z.number().int().min(20).max(400),
    chat_bubble_style: z.enum(["plain", "bubble", "minimal"]),

    // Timeouts (seconds). Global per-user knobs that override the
    // hard-coded gateway and MCP-runtime defaults. Reasoning models
    // and slow upstreams routinely need >60s, and `npx`/`uvx` MCP
    // installs can take minutes on cold networks — so the defaults
    // are generous (1h) and the bounds permit anything up to 24h.
    gateway_timeout_seconds: z.number().int().min(1).max(86_400),
    mcp_connect_timeout_seconds: z.number().int().min(1).max(86_400),
});

/** All fields optional → PATCH semantics. Sent fields replace; unsent stay. */
export const userPreferencesUpdateSchema = userPreferencesDTOSchema.partial();

export const defaultUserPreferences: UserPreferencesDTO = {
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
};

export type UserPreferencesDTO = z.infer<typeof userPreferencesDTOSchema>;
export type UserPreferencesUpdateInput = z.infer<typeof userPreferencesUpdateSchema>;
