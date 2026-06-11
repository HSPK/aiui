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
 * Two trigger sources:
 *   1. **On-mount sweep** when ANY enabled row has a null `last_check_at`
 *      / `last_health_checked_at`. The server wipes those on every boot
 *      (see lib/server/db/startup.ts), so the first dashboard load after
 *      a restart automatically re-probes everything without waiting for
 *      the next interval. Per-row immediate reprobing also catches
 *      newly-created servers.
 *   2. **Interval sweep** at the user's configured cadence (preferences:
 *      `mcp_auto_check_interval_minutes` / `provider_auto_check_interval_minutes`).
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

    /** Sweep helpers — also called by the on-mount initial-probe logic
     *  below, so factored out of the interval effects. */
    const sweepMcp = React.useCallback(async (filterFn?: (s: { id: string; enabled: boolean; last_check_at: string | null }) => boolean) => {
        const servers = mcpListRef.current.filter((s) => s.enabled && (filterFn?.(s) ?? true))
        for (const s of servers) {
            try {
                await mcpServers.check(s.id)
            } catch {
                /* persisted as last_check_error on the row */
            }
            await new Promise((r) => setTimeout(r, SEQUENTIAL_GAP_MS))
        }
        if (servers.length > 0) qc.invalidateQueries({ queryKey: ["mcp-servers"] })
    }, [qc])

    const sweepProviders = React.useCallback(async (filterFn?: (p: { id: string; enabled: boolean; health_check_url: string | null; last_health_checked_at: string | null }) => boolean) => {
        // Only providers with a configured health_check_url are probed
        // automatically — the discovery-fallback path would burn upstream
        // model-list API calls (and the admin's $) on every tick.
        const list = providerListRef.current.filter((p) => p.enabled && !!p.health_check_url && (filterFn?.(p) ?? true))
        for (const p of list) {
            try {
                await providers.check(p.id)
            } catch {
                /* surfaced via last_health_* on the row */
            }
            await new Promise((r) => setTimeout(r, SEQUENTIAL_GAP_MS))
        }
        if (list.length > 0) qc.invalidateQueries({ queryKey: ["providers"] })
    }, [qc])

    // ---- on-mount probe: reset state from server boot ----
    // Fires AS SOON AS the lists load, but only for rows whose check
    // timestamp is null (the boot-time wipe). Subsequent reads see the
    // populated timestamp and the predicate filters them out, so this
    // doesn't re-probe healthy state on every dashboard mount. Guarded
    // by initialDoneRef to ensure exactly-once-per-tab semantics.
    const initialMcpDoneRef = React.useRef(false)
    React.useEffect(() => {
        if (initialMcpDoneRef.current) return
        if (!mcpList) return
        if (!mcpList.some((s) => s.enabled && s.last_check_at == null)) return
        initialMcpDoneRef.current = true
        void sweepMcp((s) => s.last_check_at == null)
    }, [mcpList, sweepMcp])

    const initialProviderDoneRef = React.useRef(false)
    React.useEffect(() => {
        if (initialProviderDoneRef.current) return
        if (!providerList) return
        if (!providerList.some((p) => p.enabled && !!p.health_check_url && p.last_health_checked_at == null)) return
        initialProviderDoneRef.current = true
        void sweepProviders((p) => p.last_health_checked_at == null)
    }, [providerList, sweepProviders])

    // ---- interval-driven periodic sweeps ----
    React.useEffect(() => {
        if (mcpInterval <= 0) return
        const id = setInterval(() => void sweepMcp(), mcpInterval * 60_000)
        return () => clearInterval(id)
    }, [mcpInterval, sweepMcp])

    React.useEffect(() => {
        if (providerInterval <= 0) return
        const id = setInterval(() => void sweepProviders(), providerInterval * 60_000)
        return () => clearInterval(id)
    }, [providerInterval, sweepProviders])

    return null
}
