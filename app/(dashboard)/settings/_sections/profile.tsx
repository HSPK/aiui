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
                    value={prefs.user_name}
                    onChange={(e) => patch({ user_name: e.target.value })}
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
