"use client"

import * as React from "react"
import { Sliders } from "lucide-react"

import { useDeviceSettingsStore } from "@/lib/stores/device-settings-store"
import { Switch } from "@/components/ui/switch"

import { SettingsField, SettingsSection } from "./shared"

export function BehaviorSection() {
    const sendOnEnter = useDeviceSettingsStore((s) => s.sendOnEnter)
    const showTimestamps = useDeviceSettingsStore((s) => s.showTimestamps)
    const compactMode = useDeviceSettingsStore((s) => s.compactMode)
    const updateDeviceSettings = useDeviceSettingsStore((s) => s.updateDeviceSettings)

    return (
        <SettingsSection
            icon={Sliders}
            title="Device Behavior"
            description="Local-only switches — stored in this browser, never synced."
        >
            <SettingsField label="Send on Enter" description="Press Enter to send messages.">
                <Switch
                    checked={sendOnEnter}
                    onCheckedChange={(v) => updateDeviceSettings({ sendOnEnter: v })}
                />
            </SettingsField>

            <SettingsField label="Show Timestamps" description="Display message timestamps.">
                <Switch
                    checked={showTimestamps}
                    onCheckedChange={(v) => updateDeviceSettings({ showTimestamps: v })}
                />
            </SettingsField>

            <SettingsField label="Compact Mode" description="Reduce spacing in chat view.">
                <Switch
                    checked={compactMode}
                    onCheckedChange={(v) => updateDeviceSettings({ compactMode: v })}
                />
            </SettingsField>
        </SettingsSection>
    )
}
