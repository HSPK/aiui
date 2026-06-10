"use client"

import * as React from "react"
import { Timer } from "lucide-react"
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
    React.useEffect(() => { setGatewayInput(String(prefs.gateway_timeout_seconds)) }, [prefs.gateway_timeout_seconds])
    React.useEffect(() => { setMcpInput(String(prefs.mcp_connect_timeout_seconds)) }, [prefs.mcp_connect_timeout_seconds])

    const commit = (
        key: "gateway_timeout_seconds" | "mcp_connect_timeout_seconds",
        raw: string,
    ) => {
        const trimmed = raw.trim()
        if (!trimmed) {
            // Revert to persisted value if user cleared the input.
            if (key === "gateway_timeout_seconds") setGatewayInput(String(prefs.gateway_timeout_seconds))
            else setMcpInput(String(prefs.mcp_connect_timeout_seconds))
            return
        }
        const n = Number(trimmed)
        if (!Number.isFinite(n) || n < 1 || n > 86_400) {
            toast.error("Timeout must be between 1 and 86400 seconds")
            if (key === "gateway_timeout_seconds") setGatewayInput(String(prefs.gateway_timeout_seconds))
            else setMcpInput(String(prefs.mcp_connect_timeout_seconds))
            return
        }
        const next = Math.floor(n)
        if (next === prefs[key]) return
        update.mutate(
            { [key]: next },
            {
                onError: (e) => {
                    toast.error(e.message || "Failed to save")
                    if (key === "gateway_timeout_seconds") setGatewayInput(String(prefs.gateway_timeout_seconds))
                    else setMcpInput(String(prefs.mcp_connect_timeout_seconds))
                },
            },
        )
    }

    return (
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
    )
}
