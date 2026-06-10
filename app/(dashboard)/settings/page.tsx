"use client"

import * as React from "react"
import { Bot, Lock, MessageSquare, Palette, RotateCcw, Sliders, Timer, User, Wrench } from "lucide-react"
import { toast } from "sonner"

import { preferences } from "@/lib/api/preferences"
import { defaultUserPreferences } from "@/lib/schemas/preferences"
import { useDeviceSettingsStore } from "@/lib/stores/device-settings-store"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import { AppearanceSection } from "./_sections/appearance"
import { BehaviorSection } from "./_sections/behavior"
import { ChatSection } from "./_sections/chat"
import { ModelsSection } from "./_sections/models"
import { ProfileSection } from "./_sections/profile"
import { SecuritySection } from "./_sections/security"
import { TimeoutsSection } from "./_sections/timeouts"
import { ToolsSection } from "./_sections/tools"

type SectionId = "profile" | "security" | "appearance" | "models" | "chat" | "timeouts" | "behavior" | "tools"

interface SectionDef {
    id: SectionId
    label: string
    icon: React.ElementType
    Component: React.ComponentType
}

const SECTIONS: SectionDef[] = [
    { id: "profile", label: "Profile", icon: User, Component: ProfileSection },
    { id: "security", label: "Security", icon: Lock, Component: SecuritySection },
    { id: "appearance", label: "Appearance", icon: Palette, Component: AppearanceSection },
    { id: "models", label: "Models", icon: Bot, Component: ModelsSection },
    { id: "chat", label: "Chat", icon: MessageSquare, Component: ChatSection },
    { id: "timeouts", label: "Timeouts", icon: Timer, Component: TimeoutsSection },
    { id: "behavior", label: "Behavior", icon: Sliders, Component: BehaviorSection },
    { id: "tools", label: "Tools", icon: Wrench, Component: ToolsSection },
]

const DEFAULT_SECTION: SectionId = "appearance"

function parseHash(hash: string): SectionId {
    const id = hash.replace(/^#/, "") as SectionId
    return SECTIONS.some((s) => s.id === id) ? id : DEFAULT_SECTION
}

function useHashSection(): [SectionId, (next: SectionId) => void] {
    const [section, setSection] = React.useState<SectionId>(DEFAULT_SECTION)

    React.useEffect(() => {
        const sync = () => setSection(parseHash(window.location.hash))
        sync()
        window.addEventListener("hashchange", sync)
        return () => window.removeEventListener("hashchange", sync)
    }, [])

    const select = React.useCallback((next: SectionId) => {
        if (typeof window === "undefined") return
        window.location.hash = next
    }, [])

    return [section, select]
}

export default function SettingsPage() {
    const [active, selectSection] = useHashSection()
    const update = preferences.useUpdate()
    const resetDeviceSettings = useDeviceSettingsStore((s) => s.resetDeviceSettings)

    const resetAll = () => {
        update.mutate(defaultUserPreferences, {
            onSuccess: () => {
                resetDeviceSettings()
                toast.success("Settings reset")
            },
            onError: (e) => toast.error(e.message || "Failed to reset"),
        })
    }

    const ActiveComponent =
        SECTIONS.find((s) => s.id === active)?.Component ?? ProfileSection
    const activeLabel =
        SECTIONS.find((s) => s.id === active)?.label ?? "Settings"

    return (
        <div className="h-full overflow-y-auto scrollbar-thin">
            <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
                <header className="flex items-center justify-between gap-2">
                    <div>
                        <h1 className="text-lg font-semibold leading-none">Settings</h1>
                        <p className="mt-1 text-sm text-muted-foreground">
                            {activeLabel}
                        </p>
                    </div>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={resetAll}
                        disabled={update.isPending}
                    >
                        <RotateCcw className="mr-2 h-4 w-4" />
                        Reset
                    </Button>
                </header>

                <div className="flex flex-col gap-4 md:flex-row md:gap-6">
                    <SectionNav active={active} onSelect={selectSection} />
                    <div className="min-w-0 flex-1">
                        <ActiveComponent />
                    </div>
                </div>
            </div>
        </div>
    )
}

function SectionNav({
    active,
    onSelect,
}: {
    active: SectionId
    onSelect: (id: SectionId) => void
}) {
    return (
        <nav
            aria-label="Settings sections"
            className={cn(
                "shrink-0 md:w-44",
                "scrollbar-none -mx-4 flex gap-1 overflow-x-auto px-4 md:mx-0 md:flex-col md:gap-0.5 md:overflow-visible md:px-0"
            )}
        >
            {SECTIONS.map((s) => {
                const Icon = s.icon
                const isActive = active === s.id
                return (
                    <button
                        key={s.id}
                        type="button"
                        onClick={() => onSelect(s.id)}
                        className={cn(
                            "inline-flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                            "md:w-full md:justify-start",
                            isActive
                                ? "bg-muted font-medium text-foreground"
                                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                        )}
                    >
                        <Icon className="h-4 w-4 shrink-0" />
                        {s.label}
                    </button>
                )
            })}
        </nav>
    )
}
