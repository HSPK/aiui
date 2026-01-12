"use client"

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { useSettingsStore } from "@/lib/stores/settings-store"
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
import { ProviderIcon } from "@/components/provider-icons"

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
                                    <ProviderIcon provider={model.provider || "?"} />
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
    const settings = useSettingsStore()
    const [saved, setSaved] = React.useState(false)

    const { data: modelsData, isLoading: modelsLoading } = useQuery({
        queryKey: ["models"],
        queryFn: () => api.getModels(),
    })

    const models = React.useMemo(() => {
        if (!Array.isArray(modelsData)) return []
        return modelsData.map(m => ({
            name: m.name,
            provider: m.provider ?? undefined
        }))
    }, [modelsData])

    const handleSave = () => {
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
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
                    <div className="flex gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => settings.resetSettings()}
                        >
                            <RotateCcw className="h-4 w-4 mr-2" />
                            Reset
                        </Button>
                        <Button size="sm" onClick={handleSave}>
                            {saved ? (
                                <>
                                    <Check className="h-4 w-4 mr-2" />
                                    Saved
                                </>
                            ) : (
                                'Save Changes'
                            )}
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
                            value={settings.userName}
                            onChange={(e) => settings.updateSettings({ userName: e.target.value })}
                            placeholder="Enter your name"
                        />
                    </SettingsField>

                    <SettingsField label="Avatar" description="Choose an emoji avatar">
                        <div className="flex flex-wrap gap-1.5">
                            {AVATAR_OPTIONS.map((emoji) => (
                                <button
                                    key={emoji}
                                    onClick={() => settings.updateSettings({ userAvatar: emoji })}
                                    className={cn(
                                        "w-9 h-9 rounded-lg text-lg flex items-center justify-center transition-all",
                                        "hover:bg-muted border",
                                        settings.userAvatar === emoji
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
                            value={settings.defaultModel}
                            onValueChange={(v) => settings.updateSettings({ defaultModel: v })}
                            models={models}
                            isLoading={modelsLoading}
                            placeholder={modelsLoading ? "Loading..." : "Select model"}
                        />
                    </SettingsField>

                    <SettingsField label="Summary Model" description="Model for generating titles & summaries">
                        <ModelSelect
                            value={settings.defaultSummaryModel}
                            onValueChange={(v) => settings.updateSettings({ defaultSummaryModel: v })}
                            models={models}
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
                            value={settings.defaultSystemPrompt}
                            onChange={(e) => settings.updateSettings({ defaultSystemPrompt: e.target.value })}
                            placeholder="You are a helpful assistant..."
                            rows={3}
                            className="resize-none"
                        />
                    </SettingsField>

                    <SettingsField
                        label="Temperature"
                        description={settings.defaultTemperature !== undefined ? `Controls randomness (${settings.defaultTemperature.toFixed(1)})` : 'Use model default'}
                    >
                        <div className="flex items-center gap-3">
                            <Input
                                type="number"
                                min={0}
                                max={2}
                                step={0.1}
                                value={settings.defaultTemperature ?? ''}
                                onChange={(e) => {
                                    const val = e.target.value === '' ? undefined : parseFloat(e.target.value)
                                    settings.updateSettings({ defaultTemperature: val })
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
                            value={settings.defaultMaxTokens}
                            onChange={(e) => settings.updateSettings({ defaultMaxTokens: Number(e.target.value) })}
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
                            value={settings.defaultHistoryLimit}
                            onChange={(e) => settings.updateSettings({ defaultHistoryLimit: Number(e.target.value) })}
                            min={1}
                            max={50}
                        />
                    </SettingsField>
                </SettingsSection>

                {/* UI Settings */}
                <SettingsSection
                    icon={Palette}
                    title="Interface"
                    description="Customize the chat interface"
                >
                    <SettingsField
                        label="Send on Enter"
                        description="Press Enter to send messages"
                    >
                        <Switch
                            checked={settings.sendOnEnter}
                            onCheckedChange={(v) => settings.updateSettings({ sendOnEnter: v })}
                        />
                    </SettingsField>

                    <SettingsField
                        label="Show Timestamps"
                        description="Display message timestamps"
                    >
                        <Switch
                            checked={settings.showTimestamps}
                            onCheckedChange={(v) => settings.updateSettings({ showTimestamps: v })}
                        />
                    </SettingsField>

                    <SettingsField
                        label="Compact Mode"
                        description="Reduce spacing in chat view"
                    >
                        <Switch
                            checked={settings.compactMode}
                            onCheckedChange={(v) => settings.updateSettings({ compactMode: v })}
                        />
                    </SettingsField>
                </SettingsSection>
            </div>
        </div>
    )
}
