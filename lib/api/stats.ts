"use client";
import { useQuery } from "@tanstack/react-query";
import { fetcher, withQuery } from "./client";
import type { ModelStatsDTO, StatsOverviewDTO, StatsQuery } from "@/lib/schemas/stats";

const keyAll = ["stats"] as const;

export const stats = {
    keys: {
        all: () => keyAll,
        overview: (q: Partial<StatsQuery>) => [...keyAll, "overview", q] as const,
        model: (name: string, q: Partial<StatsQuery>) =>
            [...keyAll, "model", name, q] as const,
    },

    getOverview: (q: Partial<StatsQuery> = {}) =>
        fetcher<StatsOverviewDTO>(
            withQuery("/stats", q as Record<string, string | number | undefined>)
        ),

    getModel: (name: string, q: Partial<StatsQuery> = {}) =>
        fetcher<ModelStatsDTO>(
            withQuery(
                `/stats/models/${encodeURIComponent(name)}`,
                q as Record<string, string | number | undefined>
            )
        ),

    useOverview: (q: Partial<StatsQuery> = {}) =>
        useQuery({
            queryKey: stats.keys.overview(q),
            queryFn: () => stats.getOverview(q),
            staleTime: 60_000,
        }),

    useModel: (name: string | null | undefined, q: Partial<StatsQuery> = {}) =>
        useQuery({
            queryKey: stats.keys.model(name ?? "", q),
            queryFn: () => stats.getModel(name!, q),
            enabled: !!name,
            staleTime: 60_000,
        }),
};
