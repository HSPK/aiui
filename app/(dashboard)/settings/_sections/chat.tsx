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
        <SettingsSection icon={MessageSquare} title="Chat Defaults">
            <SettingsField label="System Prompt" stacked>
                <Textarea
                    value={prefs.default_system_prompt}
                    onChange={(e) => patch({ default_system_prompt: e.target.value })}
                    rows={3}
                    className="resize-none"
                />
            </SettingsField>

            <SettingsField label="History Limit">
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
