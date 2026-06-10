"use client"

import * as React from "react"
import { Bot } from "lucide-react"
import { toast } from "sonner"

import { models, preferences } from "@/lib/api"
import { defaultUserPreferences } from "@/lib/schemas/preferences"

import { ModelSelect, SettingsField, SettingsSection } from "./shared"

export function ModelsSection() {
    const { data: prefsServer } = preferences.useGet()
    const prefs = prefsServer ?? defaultUserPreferences
    const update = preferences.useUpdate()
    const { data: modelsData, isLoading } = models.useList()

    // Both "Chat Model" and "Summary Model" prefs are used by the
    // chat orchestrator — so both dropdowns must only offer chat
    // capability models. Otherwise an admin picks an embedding /
    // image model as default and the chat picker silently overrides
    // it on first send (model-selector.tsx auto-falls-back to
    // `chatModels[0]`) — the saved preference is honored on the UI
    // surface but ignored in practice.
    const chatModelOptions = React.useMemo(() => {
        if (!Array.isArray(modelsData)) return []
        return modelsData
            .filter((m) => m.type === "chat" && m.enabled !== false)
            .map((m) => ({ name: m.name, provider: m.provider ?? undefined }))
    }, [modelsData])

    const patch = (p: Parameters<typeof update.mutate>[0]) =>
        update.mutate(p, { onError: (e) => toast.error(e.message || "Failed to save") })

    return (
        <SettingsSection
            icon={Bot}
            title="Default Models"
            description="Models used when a conversation does not override them."
        >
            <SettingsField label="Chat Model" description="Default model for new conversations.">
                <ModelSelect
                    value={prefs.default_model}
                    onValueChange={(v) => patch({ default_model: v })}
                    models={chatModelOptions}
                    isLoading={isLoading}
                    placeholder={isLoading ? "Loading..." : "Select model"}
                />
            </SettingsField>

            <SettingsField label="Summary Model" description="Model for titles and summaries.">
                <ModelSelect
                    value={prefs.default_summary_model}
                    onValueChange={(v) => patch({ default_summary_model: v })}
                    models={chatModelOptions}
                    isLoading={isLoading}
                    placeholder={isLoading ? "Loading..." : "Select model"}
                />
            </SettingsField>
        </SettingsSection>
    )
}
