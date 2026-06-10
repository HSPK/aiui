"use client"

import * as React from "react"
import { Palette, Sun, Moon, Monitor, Check } from "lucide-react"
import { toast } from "sonner"

import { preferences } from "@/lib/api"
import {
    defaultUserPreferences,
    type UserPreferencesDTO,
} from "@/lib/schemas/preferences"
import { getAllThemes, type ThemeDescriptor } from "@/lib/themes"
import { cn } from "@/lib/utils"
import { Slider } from "@/components/ui/slider"

import { SettingsField, SettingsSection } from "./shared"

export function AppearanceSection() {
    const { data: prefsServer } = preferences.useGet()
    const prefs = prefsServer ?? defaultUserPreferences
    const update = preferences.useUpdate()
    const themes = React.useMemo(() => getAllThemes(), [])
    const activeTheme = themes.find((t) => t.id === prefs.theme_id)
    const forcedScheme = activeTheme?.forceScheme

    const patch = (p: Partial<UserPreferencesDTO>) =>
        update.mutate(p, { onError: (e) => toast.error(e.message || "Failed to save") })

    // Local mirror for the slider so it responds smoothly while
    // dragging; server commit fires on release via onValueCommit.
    const [cpsInput, setCpsInput] = React.useState(prefs.typewriter_cps)
    React.useEffect(() => { setCpsInput(prefs.typewriter_cps) }, [prefs.typewriter_cps])

    return (
        <div className="space-y-4">
            <SettingsSection
                icon={Palette}
                title="Theme"
                description="Pick a visual preset for the whole app."
            >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {themes.map((theme) => (
                        <ThemeTile
                            key={theme.id}
                            theme={theme}
                            active={prefs.theme_id === theme.id}
                            onSelect={() => patch({ theme_id: theme.id })}
                        />
                    ))}
                </div>

                <SettingsField
                    label="Color Scheme"
                    description={
                        forcedScheme
                            ? `The "${activeTheme?.label ?? "selected"}" theme is ${forcedScheme}-only.`
                            : "Light, dark, or follow the OS preference."
                    }
                >
                    <SchemeToggle
                        value={forcedScheme ?? prefs.theme_scheme}
                        disabled={!!forcedScheme}
                        onChange={(scheme) => patch({ theme_scheme: scheme })}
                    />
                </SettingsField>
            </SettingsSection>

            <SettingsSection
                icon={Palette}
                title="Chat Rendering"
                description="How streamed assistant messages animate and lay out."
            >
                <SettingsField
                    label="Render Mode"
                    description="Instant: no cursor. Stream: live + blinking cursor. Typewriter: smooth char-by-char."
                    stacked
                >
                    <SegmentedControl
                        value={prefs.chat_render_mode}
                        options={[
                            { value: "instant", label: "Instant" },
                            { value: "stream", label: "Stream" },
                            { value: "typewriter", label: "Typewriter" },
                        ]}
                        onChange={(v) =>
                            patch({ chat_render_mode: v as UserPreferencesDTO["chat_render_mode"] })
                        }
                    />
                </SettingsField>

                {prefs.chat_render_mode === "typewriter" && (
                    <SettingsField
                        label="Typewriter Speed"
                        description={`${cpsInput} characters per second.`}
                        stacked
                    >
                        <Slider
                            value={[cpsInput]}
                            min={20}
                            max={400}
                            step={10}
                            onValueChange={([v]) => setCpsInput(v)}
                            onValueCommit={([v]) => {
                                if (v !== prefs.typewriter_cps) patch({ typewriter_cps: v })
                            }}
                        />
                    </SettingsField>
                )}

                <SettingsField
                    label="Message Layout"
                    description="Plain: feed style. Bubble: aligned chat bubbles. Minimal: text only."
                    stacked
                >
                    <SegmentedControl
                        value={prefs.chat_bubble_style}
                        options={[
                            { value: "plain", label: "Plain" },
                            { value: "bubble", label: "Bubble" },
                            { value: "minimal", label: "Minimal" },
                        ]}
                        onChange={(v) =>
                            patch({ chat_bubble_style: v as UserPreferencesDTO["chat_bubble_style"] })
                        }
                    />
                </SettingsField>
            </SettingsSection>
        </div>
    )
}

function ThemeTile({
    theme,
    active,
    onSelect,
}: {
    theme: ThemeDescriptor
    active: boolean
    onSelect: () => void
}) {
    const [bg, primary, accent, muted] = theme.preview.swatches
    return (
        <button
            type="button"
            onClick={onSelect}
            className={cn(
                "group relative flex items-stretch gap-3 overflow-hidden rounded-xl border bg-card p-3 text-left transition-all",
                "hover:border-primary/50 hover:shadow-sm",
                active && "border-primary ring-2 ring-primary/30"
            )}
        >
            <div
                className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border"
                style={{ background: bg, color: primary }}
            >
                <span className="text-xl font-semibold leading-none">{theme.preview.glyph ?? "Aa"}</span>
                <div className="absolute bottom-1 left-1 right-1 flex h-1.5 gap-0.5">
                    <div className="flex-1 rounded-sm" style={{ background: primary }} />
                    <div className="flex-1 rounded-sm" style={{ background: accent }} />
                    <div className="flex-1 rounded-sm" style={{ background: muted }} />
                </div>
            </div>
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{theme.label}</span>
                    <span
                        className={cn(
                            "rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                            theme.flair === "cool"
                                ? "border-primary/30 bg-primary/10 text-primary"
                                : "border-border bg-muted text-muted-foreground"
                        )}
                    >
                        {theme.flair}
                    </span>
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                    {theme.description}
                </p>
            </div>
            {active && (
                <Check className="absolute right-2 top-2 h-4 w-4 text-primary" />
            )}
        </button>
    )
}

function SchemeToggle({
    value,
    onChange,
    disabled = false,
}: {
    value: UserPreferencesDTO["theme_scheme"]
    onChange: (v: UserPreferencesDTO["theme_scheme"]) => void
    disabled?: boolean
}) {
    const options = [
        { value: "light" as const, label: "Light", icon: Sun },
        { value: "dark" as const, label: "Dark", icon: Moon },
        { value: "system" as const, label: "System", icon: Monitor },
    ]
    return (
        <div className={cn("inline-flex rounded-md border bg-muted/30 p-0.5", disabled && "opacity-60")}>
            {options.map((opt) => {
                const Icon = opt.icon
                const active = value === opt.value
                return (
                    <button
                        key={opt.value}
                        type="button"
                        disabled={disabled}
                        onClick={() => onChange(opt.value)}
                        className={cn(
                            "inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs transition-colors",
                            active
                                ? "bg-background text-foreground shadow-sm"
                                : "text-muted-foreground hover:text-foreground",
                            disabled && "cursor-not-allowed"
                        )}
                    >
                        <Icon className="h-3.5 w-3.5" />
                        {opt.label}
                    </button>
                )
            })}
        </div>
    )
}

function SegmentedControl<T extends string>({
    value,
    options,
    onChange,
}: {
    value: T
    options: { value: T; label: string }[]
    onChange: (v: T) => void
}) {
    return (
        <div className="inline-flex w-full rounded-md border bg-muted/30 p-0.5 sm:w-auto">
            {options.map((opt) => {
                const active = value === opt.value
                return (
                    <button
                        key={opt.value}
                        type="button"
                        onClick={() => onChange(opt.value)}
                        className={cn(
                            "flex-1 rounded px-3 py-1.5 text-xs transition-colors sm:flex-initial",
                            active
                                ? "bg-background text-foreground shadow-sm"
                                : "text-muted-foreground hover:text-foreground"
                        )}
                    >
                        {opt.label}
                    </button>
                )
            })}
        </div>
    )
}
