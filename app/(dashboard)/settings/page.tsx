"use client"

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { useSettingsStore } from "@/lib/stores/settings-store"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card"
import { ProviderIcon } from "@/components/ProviderIcon"
import { Settings, Bot, User, MessageSquare, Palette, RotateCcw, Check } from "lucide-react"
import { cn } from "@/lib/utils"

const AVATAR_OPTIONS = ['👤', '😀', '😎', '🤖', '🦊', '🐱', '🐶', '🦁', '🐼', '🐨', '🐸', '🦄', '🌟', '💫', '🎯', '🚀']

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
        return Array.isArray(modelsData) ? modelsData : []
    }, [modelsData])

    const handleSave = () => {
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
    }

    return (
        <div className="h-full overflow-y-auto">
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
                        <Select
                            value={settings.defaultModel}
                            onValueChange={(v) => settings.updateSettings({ defaultModel: v })}
                            disabled={modelsLoading}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder={modelsLoading ? "Loading..." : "Select model"} />
                            </SelectTrigger>
                            <SelectContent>
                                {models.map((model) => (
                                    <SelectItem key={model.name} value={model.name}>
                                        <div className="flex items-center gap-2">
                                            <ProviderIcon
                                                providerName={model.provider || "unknown"}
                                                className="h-4 w-4"
                                                width={16}
                                                height={16}
                                            />
                                            <span>{model.name}</span>
                                        </div>
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </SettingsField>

                    <SettingsField label="Summary Model" description="Model for generating titles & summaries">
                        <Select
                            value={settings.defaultSummaryModel}
                            onValueChange={(v) => settings.updateSettings({ defaultSummaryModel: v })}
                            disabled={modelsLoading}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder={modelsLoading ? "Loading..." : "Select model"} />
                            </SelectTrigger>
                            <SelectContent>
                                {models.map((model) => (
                                    <SelectItem key={model.name} value={model.name}>
                                        <div className="flex items-center gap-2">
                                            <ProviderIcon
                                                providerName={model.provider || "unknown"}
                                                className="h-4 w-4"
                                                width={16}
                                                height={16}
                                            />
                                            <span>{model.name}</span>
                                        </div>
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
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
                        description={`Controls randomness (${settings.defaultTemperature.toFixed(1)})`}
                    >
                        <div className="flex items-center gap-3">
                            <Slider
                                value={[settings.defaultTemperature]}
                                onValueChange={([v]) => settings.updateSettings({ defaultTemperature: v })}
                                min={0}
                                max={2}
                                step={0.1}
                                className="flex-1"
                            />
                            <span className="text-sm text-muted-foreground w-8 text-right">
                                {settings.defaultTemperature.toFixed(1)}
                            </span>
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
