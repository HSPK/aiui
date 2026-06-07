"use client"

import * as React from "react"
import { MessageSquare } from "lucide-react"
import { toast } from "sonner"

import { preferences } from "@/lib/api"
import { defaultUserPreferences } from "@/lib/schemas/preferences"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

import { SettingsField, SettingsSection } from "./shared"

export function ChatSection() {
    const { data: prefsServer } = preferences.useGet()
    const prefs = prefsServer ?? defaultUserPreferences
    const update = preferences.useUpdate()

    const patch = (p: Parameters<typeof update.mutate>[0]) =>
        update.mutate(p, { onError: (e) => toast.error(e.message || "Failed to save") })

    return (
        <SettingsSection
            icon={MessageSquare}
            title="Chat Defaults"
            description="Parameters applied when a new conversation starts."
        >
            <SettingsField label="System Prompt" description="Default instructions for the assistant." stacked>
                <Textarea
                    value={prefs.default_system_prompt}
                    onChange={(e) => patch({ default_system_prompt: e.target.value })}
                    placeholder="You are a helpful assistant..."
                    rows={3}
                    className="resize-none"
                />
            </SettingsField>

            <SettingsField
                label="Temperature"
                description={
                    prefs.default_temperature != null
                        ? `Controls randomness (${prefs.default_temperature.toFixed(1)}).`
                        : "Empty → use model default."
                }
            >
                <Input
                    type="number"
                    min={0}
                    max={2}
                    step={0.1}
                    value={prefs.default_temperature ?? ""}
                    onChange={(e) => {
                        const val = e.target.value === "" ? null : parseFloat(e.target.value)
                        patch({ default_temperature: val })
                    }}
                    placeholder="Default (empty)"
                />
            </SettingsField>

            <SettingsField label="Max Tokens" description="Maximum response length.">
                <Input
                    type="number"
                    value={prefs.default_max_tokens}
                    onChange={(e) => patch({ default_max_tokens: Number(e.target.value) })}
                    min={256}
                    max={128000}
                />
            </SettingsField>

            <SettingsField label="History Limit" description="Messages to include for context.">
                <Input
                    type="number"
                    value={prefs.default_history_limit}
                    onChange={(e) => patch({ default_history_limit: Number(e.target.value) })}
                    min={1}
                    max={50}
                />
            </SettingsField>
        </SettingsSection>
    )
}
