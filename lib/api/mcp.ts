"use client"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import * as React from "react"
import { defineResource } from "./resource"
import { fetcher, rawFetch } from "./client"
import type {
    McpPreset,
    McpRuntimeStatusDTO,
    McpServerCreateInput,
    McpServerDTO,
    McpServerUpdateInput,
} from "@/lib/schemas/mcp"

const base = defineResource<
    McpServerDTO,
    McpServerCreateInput,
    McpServerUpdateInput,
    Record<string, unknown>,
    McpServerDTO[]
>({
    path: "/mcp/servers",
    key: "mcp-servers",
    listShape: "array",
    staleTime: 60_000,
})

/** Wire shape — mirrors lib/server/mcp/checks.ts McpCheckEvent so
 *  adding a new phase/log channel is a one-place edit on each side. */
export type McpCheckPhase = "spawning" | "starting" | "connecting" | "listing" | "ready"

export type McpCheckEvent =
    | { type: "phase"; phase: McpCheckPhase }
    | { type: "log"; line: string }
    | { type: "result"; server: McpServerDTO }
    | { type: "error"; message: string; server?: McpServerDTO }

export const mcpServers = {
    ...base,

    // ---- presets ----
    listPresets: () => fetcher<McpPreset[]>("/mcp/presets"),
    usePresets: () =>
        useQuery({
            queryKey: ["mcp-presets"] as const,
            queryFn: () => mcpServers.listPresets(),
            staleTime: 5 * 60 * 1000,
        }),

    // ---- check (one-shot JSON, kept for back-compat) ----
    check: (id: string) =>
        fetcher<McpServerDTO>(`/mcp/servers/${encodeURIComponent(id)}/check`, {
            method: "POST",
        }),
    /** Per-row check hook. The mutation INSTANCE is shared but the
     *  in-flight set is tracked locally so multiple rows can spin
     *  simultaneously — checking row B mid-flight no longer clears row
     *  A's spinner (previously `mutation.variables` was a scalar that
     *  every concurrent call clobbered).
     *
     *  Callers should use `check.isPendingId(id)` instead of `check.isPending`
     *  to drive per-row UI. */
    useCheck: (opts?: { onSuccess?: (server: McpServerDTO) => void; onError?: (err: Error) => void }) => {
        const qc = useQueryClient()
        const [pendingIds, setPendingIds] = React.useState<Set<string>>(() => new Set())
        const mutation = useMutation({
            mutationFn: (id: string) => mcpServers.check(id),
            onMutate: (id) => {
                setPendingIds((prev) => {
                    const next = new Set(prev)
                    next.add(id)
                    return next
                })
            },
            onSettled: (_data, _err, id) => {
                setPendingIds((prev) => {
                    if (!prev.has(id)) return prev
                    const next = new Set(prev)
                    next.delete(id)
                    return next
                })
            },
            onSuccess: (server) => {
                qc.invalidateQueries({ queryKey: base.keys.all() })
                opts?.onSuccess?.(server)
            },
            onError: (err: Error) => opts?.onError?.(err),
        })
        return {
            mutate: mutation.mutate,
            mutateAsync: mutation.mutateAsync,
            isPendingId: (id: string) => pendingIds.has(id),
            anyPending: pendingIds.size > 0,
            pendingCount: pendingIds.size,
        }
    },

    // ---- check (SSE stream) ----
    /** Streams every phase + stderr line from the server check, then
     *  resolves with the final DTO. Caller's onEvent is invoked for
     *  every event including the terminating `result` / `error`. */
    checkStream: async (
        id: string,
        onEvent: (ev: McpCheckEvent) => void,
        opts?: { signal?: AbortSignal },
    ): Promise<McpServerDTO | null> => {
        const res = await rawFetch(`/mcp/servers/${encodeURIComponent(id)}/check`, {
            method: "POST",
            headers: { Accept: "text/event-stream" },
            signal: opts?.signal,
        })
        if (!res.body) throw new Error("No response body")

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buf = ""
        let last: McpServerDTO | null = null

        try {
            while (true) {
                const { done, value } = await reader.read()
                if (done) break
                buf += decoder.decode(value, { stream: true })
                // SSE frames are separated by \n\n.
                let nl = buf.indexOf("\n\n")
                while (nl !== -1) {
                    const frame = buf.slice(0, nl)
                    buf = buf.slice(nl + 2)
                    const dataLine = frame.split("\n").find((l) => l.startsWith("data: "))
                    if (dataLine) {
                        try {
                            const ev = JSON.parse(dataLine.slice(6)) as McpCheckEvent
                            onEvent(ev)
                            if (ev.type === "result") last = ev.server
                            else if (ev.type === "error" && ev.server) last = ev.server
                        } catch { /* malformed frame, skip */ }
                    }
                    nl = buf.indexOf("\n\n")
                }
            }
        } finally {
            try { reader.releaseLock() } catch { /* ignore */ }
        }
        return last
    },
    useCheckStream: () => {
        const qc = useQueryClient()
        const [phase, setPhase] = React.useState<McpCheckPhase | null>(null)
        const [logs, setLogs] = React.useState<string[]>([])
        const [isChecking, setIsChecking] = React.useState(false)
        const [error, setError] = React.useState<string | null>(null)
        const [result, setResult] = React.useState<McpServerDTO | null>(null)
        const abortRef = React.useRef<AbortController | null>(null)

        const reset = React.useCallback(() => {
            setPhase(null)
            setLogs([])
            setError(null)
            setResult(null)
        }, [])

        const cancel = React.useCallback(() => {
            abortRef.current?.abort()
            abortRef.current = null
            setIsChecking(false)
        }, [])

        const run = React.useCallback(
            async (id: string) => {
                reset()
                setIsChecking(true)
                const ctrl = new AbortController()
                abortRef.current = ctrl
                try {
                    const final = await mcpServers.checkStream(
                        id,
                        (ev) => {
                            if (ev.type === "phase") setPhase(ev.phase)
                            else if (ev.type === "log") setLogs((prev) => [...prev, ev.line])
                            else if (ev.type === "result") setResult(ev.server)
                            else if (ev.type === "error") {
                                setError(ev.message)
                                if (ev.server) setResult(ev.server)
                            }
                        },
                        { signal: ctrl.signal },
                    )
                    qc.invalidateQueries({ queryKey: base.keys.all() })
                    return final
                } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err)
                    if (!ctrl.signal.aborted) setError(msg)
                    return null
                } finally {
                    setIsChecking(false)
                    abortRef.current = null
                }
            },
            [reset, qc],
        )

        React.useEffect(() => () => abortRef.current?.abort(), [])

        return { run, cancel, reset, phase, logs, isChecking, error, result }
    },

    // ---- runtime status + lifecycle controls ----
    runtimeKey: (id: string) => ["mcp-servers", id, "runtime"] as const,
    runtime: (id: string, logLines?: number) =>
        fetcher<McpRuntimeStatusDTO>(
            `/mcp/servers/${encodeURIComponent(id)}/runtime${logLines !== undefined ? `?log_lines=${logLines}` : ""}`,
        ),
    /** Poll the runtime status while the details sheet is open. The
     *  refetch interval is short (3 s) because PID / uptime / log tail
     *  are the high-value bits — admins watching this panel want
     *  near-live feedback. Stops polling when the component unmounts
     *  via TanStack Query's `enabled` gate. */
    useRuntime: (id: string | null, opts?: { enabled?: boolean; logLines?: number }) =>
        useQuery({
            queryKey: id ? mcpServers.runtimeKey(id) : ["mcp-servers", "_disabled", "runtime"],
            queryFn: () => mcpServers.runtime(id!, opts?.logLines),
            enabled: !!id && opts?.enabled !== false,
            refetchInterval: 3_000,
            refetchIntervalInBackground: false,
            staleTime: 0,
        }),

    /** Force-close the cached transport. The next consumer (tool call,
     *  re-check, restart) will transparently rebuild — stop is one-shot,
     *  not a persistent disable. */
    stop: (id: string) =>
        fetcher<McpRuntimeStatusDTO>(`/mcp/servers/${encodeURIComponent(id)}/stop`, {
            method: "POST",
        }),
    useStop: (opts?: { onSuccess?: (status: McpRuntimeStatusDTO) => void; onError?: (err: Error) => void }) => {
        const qc = useQueryClient()
        return useMutation({
            mutationFn: (id: string) => mcpServers.stop(id),
            onSuccess: (status, id) => {
                qc.invalidateQueries({ queryKey: mcpServers.runtimeKey(id) })
                qc.invalidateQueries({ queryKey: base.keys.all() })
                opts?.onSuccess?.(status)
            },
            onError: (e: Error) => opts?.onError?.(e),
        })
    },

    /** Stop + immediate re-check. Use for "kick a wedged server" — the
     *  current connection is closed and a fresh spawn + tools/list
     *  validation runs against the live config. */
    restart: (id: string) =>
        fetcher<McpServerDTO>(`/mcp/servers/${encodeURIComponent(id)}/restart`, {
            method: "POST",
        }),
    useRestart: (opts?: { onSuccess?: (server: McpServerDTO) => void; onError?: (err: Error) => void }) => {
        const qc = useQueryClient()
        return useMutation({
            mutationFn: (id: string) => mcpServers.restart(id),
            onSuccess: (server, id) => {
                qc.invalidateQueries({ queryKey: mcpServers.runtimeKey(id) })
                qc.invalidateQueries({ queryKey: base.keys.all() })
                opts?.onSuccess?.(server)
            },
            onError: (e: Error) => opts?.onError?.(e),
        })
    },
}
