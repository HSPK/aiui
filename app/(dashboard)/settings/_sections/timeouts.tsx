"use client"

import * as React from "react"
import { Activity, Timer } from "lucide-react"
import { toast } from "sonner"

import { preferences } from "@/lib/api"
import { defaultUserPreferences } from "@/lib/schemas/preferences"
import { Input } from "@/components/ui/input"

import { SettingsField, SettingsSection } from "./shared"

/**
 * Per-user timeout overrides. These wall-clock bounds replace the
 * system defaults for the calling user only, so anyone hitting the
 * gateway with their own session (or an API key tied to their
 * account) gets the budget they configured here. MCP `connect_timeout`
 * applies to user-triggered re-checks; background validations from
 * CRUD use the system default.
 */
export function TimeoutsSection() {
    const { data: prefsServer } = preferences.useGet()
    const prefs = prefsServer ?? defaultUserPreferences
    const update = preferences.useUpdate()

    // Debounced commit so typing a 4-digit number doesn't spam the
    // PATCH endpoint. Local mirror reflects the input instantly.
    const [gatewayInput, setGatewayInput] = React.useState(String(prefs.gateway_timeout_seconds))
    const [mcpInput, setMcpInput] = React.useState(String(prefs.mcp_connect_timeout_seconds))
    const [mcpAutoInput, setMcpAutoInput] = React.useState(String(prefs.mcp_auto_check_interval_minutes))
    const [providerAutoInput, setProviderAutoInput] = React.useState(String(prefs.provider_auto_check_interval_minutes))
    React.useEffect(() => { setGatewayInput(String(prefs.gateway_timeout_seconds)) }, [prefs.gateway_timeout_seconds])
    React.useEffect(() => { setMcpInput(String(prefs.mcp_connect_timeout_seconds)) }, [prefs.mcp_connect_timeout_seconds])
    React.useEffect(() => { setMcpAutoInput(String(prefs.mcp_auto_check_interval_minutes)) }, [prefs.mcp_auto_check_interval_minutes])
    React.useEffect(() => { setProviderAutoInput(String(prefs.provider_auto_check_interval_minutes)) }, [prefs.provider_auto_check_interval_minutes])

    const fieldRefs = {
        gateway_timeout_seconds: { value: prefs.gateway_timeout_seconds, set: setGatewayInput, min: 1, max: 86_400 },
        mcp_connect_timeout_seconds: { value: prefs.mcp_connect_timeout_seconds, set: setMcpInput, min: 1, max: 86_400 },
        mcp_auto_check_interval_minutes: { value: prefs.mcp_auto_check_interval_minutes, set: setMcpAutoInput, min: 0, max: 1440 },
        provider_auto_check_interval_minutes: { value: prefs.provider_auto_check_interval_minutes, set: setProviderAutoInput, min: 0, max: 1440 },
    } as const

    const commit = (key: keyof typeof fieldRefs, raw: string) => {
        const ref = fieldRefs[key]
        const trimmed = raw.trim()
        if (!trimmed) {
            ref.set(String(ref.value))
            return
        }
        const n = Number(trimmed)
        if (!Number.isFinite(n) || n < ref.min || n > ref.max) {
            toast.error(`Value must be between ${ref.min} and ${ref.max}`)
            ref.set(String(ref.value))
            return
        }
        const next = Math.floor(n)
        if (next === ref.value) return
        update.mutate(
            { [key]: next },
            {
                onError: (e) => {
                    toast.error(e.message || "Failed to save")
                    ref.set(String(ref.value))
                },
            },
        )
    }

    return (
        <>
            <SettingsSection
                icon={Timer}
                title="Timeouts"
                description="Wall-clock budgets for upstream calls."
            >
                <SettingsField
                    label="Gateway request (seconds)"
                    description="Chat, image, embedding, audio, rerank, video."
                >
                    <Input
                        type="number"
                        min={1}
                        max={86_400}
                        value={gatewayInput}
                        onChange={(e) => setGatewayInput(e.target.value)}
                        onBlur={(e) => commit("gateway_timeout_seconds", e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur()
                        }}
                        className="w-32 text-right"
                    />
                </SettingsField>

                <SettingsField
                    label="MCP connect (seconds)"
                    description="Initialize handshake + package install on cold cache."
                >
                    <Input
                        type="number"
                        min={1}
                        max={86_400}
                        value={mcpInput}
                        onChange={(e) => setMcpInput(e.target.value)}
                        onBlur={(e) => commit("mcp_connect_timeout_seconds", e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur()
                        }}
                        className="w-32 text-right"
                    />
                </SettingsField>
            </SettingsSection>

            <SettingsSection
                icon={Activity}
                title="Auto health checks"
                description="Polled while the dashboard tab is open. 0 = disabled."
            >
                <SettingsField
                    label="MCP servers (minutes)"
                    description="Re-probes every enabled MCP server on this cadence."
                >
                    <Input
                        type="number"
                        min={0}
                        max={1440}
                        value={mcpAutoInput}
                        onChange={(e) => setMcpAutoInput(e.target.value)}
                        onBlur={(e) => commit("mcp_auto_check_interval_minutes", e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur()
                        }}
                        className="w-32 text-right"
                    />
                </SettingsField>

                <SettingsField
                    label="Providers (minutes)"
                    description="Re-probes the health-check URL of every provider that has one."
                >
                    <Input
                        type="number"
                        min={0}
                        max={1440}
                        value={providerAutoInput}
                        onChange={(e) => setProviderAutoInput(e.target.value)}
                        onBlur={(e) => commit("provider_auto_check_interval_minutes", e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur()
                        }}
                        className="w-32 text-right"
                    />
                </SettingsField>
            </SettingsSection>
        </>
    )
}
