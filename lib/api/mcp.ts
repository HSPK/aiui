"use client"
import { useQuery } from "@tanstack/react-query"
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
}
