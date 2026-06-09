"use client"

import { useShallow } from "zustand/react/shallow"
import { usePlaygroundStore } from "@/lib/stores/playground-store"
import { preferences } from "@/lib/api/preferences"
import { defaultUserPreferences } from "@/lib/schemas/preferences"

/** Derived per-conversation config — falls through to account defaults
 *  when the conversation hasn't overridden a field. Subscribes to the
 *  playground store + the prefs query, so consumers re-render reactively
 *  on either source changing. */
export function useChatConfig(conversationId: string): {
    historyLimit: number
    systemPrompt: string
    singleModelMode: boolean
} {
    const settings = usePlaygroundStore(
        useShallow((s) => s.settings[conversationId]),
    )
    const { data: userPrefs } = preferences.useGet()
    const prefs = userPrefs ?? defaultUserPreferences

    return {
        historyLimit: settings?.historyLimit ?? prefs.default_history_limit,
        systemPrompt: settings?.systemPrompt ?? prefs.default_system_prompt,
        singleModelMode: settings?.singleModelMode ?? false,
    }
}
