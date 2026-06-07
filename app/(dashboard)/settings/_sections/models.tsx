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

    const modelOptions = React.useMemo(() => {
        if (!Array.isArray(modelsData)) return []
        return modelsData.map((m) => ({ name: m.name, provider: m.provider ?? undefined }))
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
                    models={modelOptions}
                    isLoading={isLoading}
                    placeholder={isLoading ? "Loading..." : "Select model"}
                />
            </SettingsField>

            <SettingsField label="Summary Model" description="Model for titles and summaries.">
                <ModelSelect
                    value={prefs.default_summary_model}
                    onValueChange={(v) => patch({ default_summary_model: v })}
                    models={modelOptions}
                    isLoading={isLoading}
                    placeholder={isLoading ? "Loading..." : "Select model"}
                />
            </SettingsField>
        </SettingsSection>
    )
}
