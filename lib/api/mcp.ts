"use client"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { defineResource } from "./resource"
import { fetcher } from "./client"
import type {
    McpPreset,
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

    // ---- check ----
    check: (id: string) =>
        fetcher<McpServerDTO>(`/mcp/servers/${encodeURIComponent(id)}/check`, {
            method: "POST",
        }),
    useCheck: (opts?: { onSuccess?: (server: McpServerDTO) => void; onError?: (err: Error) => void }) => {
        const qc = useQueryClient()
        return useMutation({
            mutationFn: (id: string) => mcpServers.check(id),
            onSuccess: (server) => {
                qc.invalidateQueries({ queryKey: base.keys.all() })
                opts?.onSuccess?.(server)
            },
            onError: (err: Error) => opts?.onError?.(err),
        })
    },
}
