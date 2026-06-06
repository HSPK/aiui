"use client"

import { models, preferences } from "@/lib/api";
import * as React from "react"
import { useQuery } from "@tanstack/react-query"

import { useDeviceSettingsStore } from "@/lib/stores/device-settings-store"
import { defaultUserPreferences } from "@/lib/schemas/preferences"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card"
import { RotateCcw, Check, Bot, User, MessageSquare, Palette, Settings, ChevronDown, Search } from "lucide-react"
import { cn } from "@/lib/utils"
import { ProviderIcon } from "@/components/ProviderIcon"
import { toast } from "sonner"

const AVATAR_OPTIONS = ['👤', '😀', '😎', '🤖', '🦊', '🐱', '🐶', '🦁', '🐼', '🐨', '🐸', '🦄', '🌟', '💫', '🎯', '🚀']

// Fast model selector using native dropdown
const ModelSelect = React.memo(({
    value,
    onValueChange,
    models,
    isLoading,
    placeholder
}: {
    value: string
    onValueChange: (v: string) => void
    models: Array<{ name: string; provider?: string }>
    isLoading: boolean
    placeholder: string
}) => {
    const [open, setOpen] = React.useState(false)
    const [search, setSearch] = React.useState("")
    const containerRef = React.useRef<HTMLDivElement>(null)

    const filtered = React.useMemo(() => {
        if (!search) return models
        const q = search.toLowerCase()
        return models.filter(m => m.name.toLowerCase().includes(q))
    }, [models, search])

    // Close on click outside
    React.useEffect(() => {
        if (!open) return
        const handler = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setOpen(false)
            }
        }
        document.addEventListener('mousedown', handler)
        return () => document.removeEventListener('mousedown', handler)
    }, [open])

    React.useEffect(() => {
        if (!open) setSearch("")
    }, [open])

    return (
        <div ref={containerRef} className="relative">
            <button
                type="button"
                onClick={() => !isLoading && setOpen(!open)}
                className={cn(
                    "flex items-center justify-between w-full h-9 px-3 rounded-md border bg-transparent text-sm",
                    "hover:bg-muted/50 transition-colors",
                    isLoading && "opacity-50 cursor-not-allowed"
                )}
                disabled={isLoading}
            >
                <span className="truncate">{value || placeholder}</span>
                <ChevronDown className="h-4 w-4 opacity-50 shrink-0" />
            </button>
            {open && (
                <div className="absolute z-50 w-full mt-1 rounded-md border bg-popover shadow-md">
                    <div className="p-2 border-b">
                        <div className="relative">
                            <Search className="absolute left-2 top-1.5 h-3.5 w-3.5 text-muted-foreground" />
                            <Input
                                placeholder="Search..."
                                className="pl-7 h-7 text-xs"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                autoFocus
                            />
                        </div>
                    </div>
                    <div className="max-h-[240px] overflow-y-auto scrollbar-thin p-1">
                        {filtered.length === 0 ? (
                            <div className="p-2 text-sm text-muted-foreground">No models</div>
                        ) : (
                            filtered.map((model) => (
                                <button
                                    key={model.name}
                                    type="button"
                                    onClick={() => {
                                        onValueChange(model.name)
                                        setOpen(false)
                                    }}
                                    className={cn(
                                        "w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded-sm text-left",
                                        value === model.name ? "bg-accent" : "hover:bg-muted/50"
                                    )}
                                >
                                    <ProviderIcon providerName={model.provider || "?"} />
                                    <span className="truncate">{model.name}</span>
                                </button>
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
    )
})
ModelSelect.displayName = "ModelSelect"

function SettingsSection({ icon: Icon, title, description, children }: {
    icon: React.ElementType
    title: string
    description: string
    children: React.ReactNode
}) {
    return (
        <Card>
            <CardHeader className="pb-4">
                <div className="flex items-center gap-2">
                    <div className="p-2 rounded-lg bg-primary/10">
                        <Icon className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                        <CardTitle className="text-base">{title}</CardTitle>
                        <CardDescription className="text-sm">{description}</CardDescription>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                {children}
            </CardContent>
        </Card>
    )
}

function SettingsField({ label, description, children }: {
    label: string
    description?: string
    children: React.ReactNode
}) {
    return (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4">
            <div className="space-y-0.5 shrink-0">
                <Label className="text-sm font-medium">{label}</Label>
                {description && (
                    <p className="text-xs text-muted-foreground">{description}</p>
                )}
            </div>
            <div className="sm:max-w-[280px] w-full">
                {children}
            </div>
        </div>
    )
}

export default function SettingsPage() {
    const { data: userPrefsServer } = preferences.useGet()
    const updateUserPrefs = preferences.useUpdate()
    const userPrefs = userPrefsServer ?? defaultUserPreferences
    const deviceSettings = useDeviceSettingsStore()
    const [saved, setSaved] = React.useState(false)

    const { data: modelsData, isLoading: modelsLoading } = useQuery({
        queryKey: ["models"],
        queryFn: () => models.list(),
    })

    const modelOptions = React.useMemo(() => {
        if (!Array.isArray(modelsData)) return []
        return modelsData.map(m => ({
            name: m.name,
            provider: m.provider ?? undefined
        }))
    }, [modelsData])

    const patchUserPrefs = (patch: Parameters<typeof updateUserPrefs.mutate>[0]) => {
        updateUserPrefs.mutate(patch, {
            onSuccess: () => {
                setSaved(true)
                setTimeout(() => setSaved(false), 1500)
            },
            onError: (err) => toast.error(err.message || "Failed to save"),
        })
    }

    const resetAll = () => {
        updateUserPrefs.mutate(defaultUserPreferences, {
            onSuccess: () => {
                deviceSettings.resetDeviceSettings()
                toast.success("Settings reset")
            },
            onError: (err) => toast.error(err.message || "Failed to reset"),
        })
    }

    return (
        <div className="h-full overflow-y-auto scrollbar-thin">
            <div className="max-w-3xl mx-auto p-6 space-y-6">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div className="space-y-1">
                        <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                            <Settings className="h-6 w-6" />
                            Settings
                        </h2>
                        <p className="text-muted-foreground text-sm">
                            Manage your preferences and default configurations
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        {saved && (
                            <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                                <Check className="h-3 w-3" /> Saved
                            </span>
                        )}
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={resetAll}
                            disabled={updateUserPrefs.isPending}
                        >
                            <RotateCcw className="h-4 w-4 mr-2" />
                            Reset
                        </Button>
                    </div>
                </div>

                {/* User Settings */}
                <SettingsSection
                    icon={User}
                    title="User Profile"
                    description="Customize your display name and avatar"
                >
                    <SettingsField label="Display Name" description="Your name in conversations">
                        <Input
                            value={userPrefs.user_name}
                            onChange={(e) => patchUserPrefs({ user_name: e.target.value })}
                            placeholder="Enter your name"
                        />
                    </SettingsField>

                    <SettingsField label="Avatar" description="Choose an emoji avatar">
                        <div className="flex flex-wrap gap-1.5">
                            {AVATAR_OPTIONS.map((emoji) => (
                                <button
                                    key={emoji}
                                    onClick={() => patchUserPrefs({ user_avatar: emoji })}
                                    className={cn(
                                        "w-9 h-9 rounded-lg text-lg flex items-center justify-center transition-all",
                                        "hover:bg-muted border",
                                        userPrefs.user_avatar === emoji
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

                {/* Model Settings */}
                <SettingsSection
                    icon={Bot}
                    title="Default Models"
                    description="Set default models for different tasks"
                >
                    <SettingsField label="Chat Model" description="Default model for conversations">
                        <ModelSelect
                            value={userPrefs.default_model}
                            onValueChange={(v) => patchUserPrefs({ default_model: v })}
                            models={modelOptions}
                            isLoading={modelsLoading}
                            placeholder={modelsLoading ? "Loading..." : "Select model"}
                        />
                    </SettingsField>

                    <SettingsField label="Summary Model" description="Model for generating titles & summaries">
                        <ModelSelect
                            value={userPrefs.default_summary_model}
                            onValueChange={(v) => patchUserPrefs({ default_summary_model: v })}
                            models={modelOptions}
                            isLoading={modelsLoading}
                            placeholder={modelsLoading ? "Loading..." : "Select model"}
                        />
                    </SettingsField>
                </SettingsSection>

                {/* Chat Settings */}
                <SettingsSection
                    icon={MessageSquare}
                    title="Chat Defaults"
                    description="Default parameters for new conversations"
                >
                    <SettingsField label="System Prompt" description="Default instructions for the AI">
                        <Textarea
                            value={userPrefs.default_system_prompt}
                            onChange={(e) => patchUserPrefs({ default_system_prompt: e.target.value })}
                            placeholder="You are a helpful assistant..."
                            rows={3}
                            className="resize-none"
                        />
                    </SettingsField>

                    <SettingsField
                        label="Temperature"
                        description={userPrefs.default_temperature != null ? `Controls randomness (${userPrefs.default_temperature.toFixed(1)})` : 'Use model default'}
                    >
                        <div className="flex items-center gap-3">
                            <Input
                                type="number"
                                min={0}
                                max={2}
                                step={0.1}
                                value={userPrefs.default_temperature ?? ''}
                                onChange={(e) => {
                                    const val = e.target.value === '' ? null : parseFloat(e.target.value)
                                    patchUserPrefs({ default_temperature: val })
                                }}
                                placeholder="Default (empty)"
                                className="flex-1"
                            />
                        </div>
                    </SettingsField>

                    <SettingsField
                        label="Max Tokens"
                        description="Maximum response length"
                    >
                        <Input
                            type="number"
                            value={userPrefs.default_max_tokens}
                            onChange={(e) => patchUserPrefs({ default_max_tokens: Number(e.target.value) })}
                            min={256}
                            max={128000}
                        />
                    </SettingsField>

                    <SettingsField
                        label="History Limit"
                        description="Messages to include for context"
                    >
                        <Input
                            type="number"
                            value={userPrefs.default_history_limit}
                            onChange={(e) => patchUserPrefs({ default_history_limit: Number(e.target.value) })}
                            min={1}
                            max={50}
                        />
                    </SettingsField>
                </SettingsSection>

                {/* UI Settings — device-local, NOT synced across devices */}
                <SettingsSection
                    icon={Palette}
                    title="Interface"
                    description="Customize the chat interface (this device only)"
                >
                    <SettingsField
                        label="Send on Enter"
                        description="Press Enter to send messages"
                    >
                        <Switch
                            checked={deviceSettings.sendOnEnter}
                            onCheckedChange={(v) => deviceSettings.updateDeviceSettings({ sendOnEnter: v })}
                        />
                    </SettingsField>

                    <SettingsField
                        label="Show Timestamps"
                        description="Display message timestamps"
                    >
                        <Switch
                            checked={deviceSettings.showTimestamps}
                            onCheckedChange={(v) => deviceSettings.updateDeviceSettings({ showTimestamps: v })}
                        />
                    </SettingsField>

                    <SettingsField
                        label="Compact Mode"
                        description="Reduce spacing in chat view"
                    >
                        <Switch
                            checked={deviceSettings.compactMode}
                            onCheckedChange={(v) => deviceSettings.updateDeviceSettings({ compactMode: v })}
                        />
                    </SettingsField>
                </SettingsSection>
            </div>
        </div>
    )
}
