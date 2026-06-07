"use client"

import * as React from "react"
import { Sliders } from "lucide-react"

import { useDeviceSettingsStore } from "@/lib/stores/device-settings-store"
import { Switch } from "@/components/ui/switch"

import { SettingsField, SettingsSection } from "./shared"

export function BehaviorSection() {
    const deviceSettings = useDeviceSettingsStore()

    return (
        <SettingsSection
            icon={Sliders}
            title="Device Behavior"
            description="Local-only switches — stored in this browser, never synced."
        >
            <SettingsField label="Send on Enter" description="Press Enter to send messages.">
                <Switch
                    checked={deviceSettings.sendOnEnter}
                    onCheckedChange={(v) => deviceSettings.updateDeviceSettings({ sendOnEnter: v })}
                />
            </SettingsField>

            <SettingsField label="Show Timestamps" description="Display message timestamps.">
                <Switch
                    checked={deviceSettings.showTimestamps}
                    onCheckedChange={(v) => deviceSettings.updateDeviceSettings({ showTimestamps: v })}
                />
            </SettingsField>

            <SettingsField label="Compact Mode" description="Reduce spacing in chat view.">
                <Switch
                    checked={deviceSettings.compactMode}
                    onCheckedChange={(v) => deviceSettings.updateDeviceSettings({ compactMode: v })}
                />
            </SettingsField>
        </SettingsSection>
    )
}
