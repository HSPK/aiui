"use client"

import * as React from "react"
import { User } from "lucide-react"
import { toast } from "sonner"

import { preferences } from "@/lib/api/preferences"
import { defaultUserPreferences } from "@/lib/schemas/preferences"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

import { SettingsField, SettingsSection } from "./shared"

const AVATAR_OPTIONS = [
    "👤", "😀", "😎", "🤖", "🦊", "🐱", "🐶", "🦁",
    "🐼", "🐨", "🐸", "🦄", "🌟", "💫", "🎯", "🚀",
]

export function ProfileSection() {
    const { data: prefsServer } = preferences.useGet()
    const prefs = prefsServer ?? defaultUserPreferences
    const update = preferences.useUpdate()

    const patch = (p: Parameters<typeof update.mutate>[0]) =>
        update.mutate(p, { onError: (e) => toast.error(e.message || "Failed to save") })

    // Local mirror so typing doesn't trigger a PATCH per keystroke.
    // Commit on blur / Enter, matching TimeoutsSection.
    const [nameInput, setNameInput] = React.useState(prefs.user_name)
    React.useEffect(() => { setNameInput(prefs.user_name) }, [prefs.user_name])

    const commitName = (raw: string) => {
        const next = raw.trim()
        if (!next || next === prefs.user_name) {
            setNameInput(prefs.user_name)
            return
        }
        update.mutate(
            { user_name: next },
            {
                onError: (e) => {
                    toast.error(e.message || "Failed to save")
                    // Revert the input back to the persisted value —
                    // otherwise the textbox keeps showing the rejected
                    // string and every subsequent blur retries the
                    // failing PATCH.
                    setNameInput(prefs.user_name)
                },
            },
        )
    }

    return (
        <SettingsSection
            icon={User}
            title="User Profile"
            description="The display name and avatar shown across the app."
        >
            <SettingsField
                label="Display Name"
                description="Shown in the header, chat messages, and conversation list."
            >
                <Input
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    onBlur={(e) => commitName(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur()
                    }}
                    maxLength={120}
                    placeholder="Your name"
                />
            </SettingsField>

            <SettingsField label="Avatar" description="Pick an emoji avatar." stacked>
                <div className="flex flex-wrap gap-1.5">
                    {AVATAR_OPTIONS.map((emoji) => (
                        <button
                            key={emoji}
                            type="button"
                            onClick={() => patch({ user_avatar: emoji })}
                            className={cn(
                                "flex h-9 w-9 items-center justify-center rounded-lg border text-lg transition-all hover:bg-muted",
                                prefs.user_avatar === emoji
                                    ? "border-primary bg-primary/10 ring-2 ring-primary/20"
                                    : "border-transparent"
                            )}
                        >
                            {emoji}
                        </button>
                    ))}
                </div>
            </SettingsField>
        </SettingsSection>
    )
}
