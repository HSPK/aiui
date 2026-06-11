"use client"

import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"

import { preferences } from "@/lib/api/preferences"
import { mcpServers } from "@/lib/api/mcp"
import { providers } from "@/lib/api/providers"

/**
 * Browser-driven periodic health checks for MCP servers + providers.
 *
 * Lives client-side (not server-side cron) because Loom is a single-
 * process self-hosted portal with no job runtime. Mounting this once
 * in the dashboard layout means the checks tick whenever an admin
 * tab is open and stop cleanly when nobody is looking — which is
 * the correct behavior for a self-hosted tool (nobody to read the
 * alerts when nobody's logged in).
 *
 * Sequential per-tick (not Promise.all) so a single sweep doesn't
 * fire N concurrent upstream probes against the same DB transaction
 * queue. Adds 100ms jitter between probes so the operator's request
 * latency log isn't dominated by sync-tick spikes.
 */
const SEQUENTIAL_GAP_MS = 100

export function AutoHealthChecks() {
    const { data: prefs } = preferences.useGet()
    const { data: mcpList } = mcpServers.useList()
    const { data: providerList } = providers.useList()
    const qc = useQueryClient()

    const mcpInterval = prefs?.mcp_auto_check_interval_minutes ?? 0
    const providerInterval = prefs?.provider_auto_check_interval_minutes ?? 0

    // Snapshot the live lists in refs so the interval handler sees
    // the latest data without re-arming the timer on every list
    // refetch (which would reset the cadence).
    const mcpListRef = React.useRef(mcpList ?? [])
    const providerListRef = React.useRef(providerList ?? [])
    React.useEffect(() => { mcpListRef.current = mcpList ?? [] }, [mcpList])
    React.useEffect(() => { providerListRef.current = providerList ?? [] }, [providerList])

    React.useEffect(() => {
        if (mcpInterval <= 0) return
        const tick = async () => {
            const servers = mcpListRef.current.filter((s) => s.enabled)
            for (const s of servers) {
                try {
                    await mcpServers.check(s.id)
                } catch {
                    // Persisted as last_check_error on the row; ignore here.
                }
                await new Promise((r) => setTimeout(r, SEQUENTIAL_GAP_MS))
            }
            qc.invalidateQueries({ queryKey: ["mcp-servers"] })
        }
        const id = setInterval(tick, mcpInterval * 60_000)
        return () => clearInterval(id)
    }, [mcpInterval, qc])

    React.useEffect(() => {
        if (providerInterval <= 0) return
        const tick = async () => {
            // Only providers with a configured health_check_url are
            // probed automatically — the discovery-fallback path would
            // burn upstream model-list API calls (and the admin's $)
            // on every tick, which is rarely what the user wants.
            const list = providerListRef.current.filter((p) => p.enabled && !!p.health_check_url)
            for (const p of list) {
                try {
                    await providers.check(p.id)
                } catch {
                    /* surfaced via last_health_* on the row */
                }
                await new Promise((r) => setTimeout(r, SEQUENTIAL_GAP_MS))
            }
            qc.invalidateQueries({ queryKey: ["providers"] })
        }
        const id = setInterval(tick, providerInterval * 60_000)
        return () => clearInterval(id)
    }, [providerInterval, qc])

    return null
}
