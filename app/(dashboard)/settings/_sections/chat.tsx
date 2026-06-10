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

    // Mirror server state locally; commit on blur / Enter so typing
    // doesn't spam PATCH /api/preferences on every keystroke.
    const [promptInput, setPromptInput] = React.useState(prefs.default_system_prompt)
    const [limitInput, setLimitInput] = React.useState(String(prefs.default_history_limit))
    React.useEffect(() => { setPromptInput(prefs.default_system_prompt) }, [prefs.default_system_prompt])
    React.useEffect(() => { setLimitInput(String(prefs.default_history_limit)) }, [prefs.default_history_limit])

    const commitPrompt = (raw: string) => {
        if (raw === prefs.default_system_prompt) return
        update.mutate(
            { default_system_prompt: raw },
            {
                onError: (e) => {
                    toast.error(e.message || "Failed to save")
                    setPromptInput(prefs.default_system_prompt)
                },
            },
        )
    }
    const commitLimit = (raw: string) => {
        const n = Number(raw.trim())
        if (!Number.isFinite(n) || n < 1 || n > 50) {
            toast.error("History limit must be between 1 and 50")
            setLimitInput(String(prefs.default_history_limit))
            return
        }
        const next = Math.floor(n)
        if (next === prefs.default_history_limit) return
        update.mutate(
            { default_history_limit: next },
            {
                onError: (e) => {
                    toast.error(e.message || "Failed to save")
                    setLimitInput(String(prefs.default_history_limit))
                },
            },
        )
    }

    return (
        <SettingsSection icon={MessageSquare} title="Chat Defaults">
            <SettingsField label="System Prompt" stacked>
                <Textarea
                    value={promptInput}
                    onChange={(e) => setPromptInput(e.target.value)}
                    onBlur={(e) => commitPrompt(e.target.value)}
                    rows={3}
                    maxLength={20_000}
                    className="resize-none"
                />
            </SettingsField>

            <SettingsField label="History Limit">
                <Input
                    type="number"
                    value={limitInput}
                    onChange={(e) => setLimitInput(e.target.value)}
                    onBlur={(e) => commitLimit(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur()
                    }}
                    min={1}
                    max={50}
                />
            </SettingsField>
        </SettingsSection>
    )
}
