"use client";
import { useQuery } from "@tanstack/react-query";
import { logsApi } from "@/lib/api/logs";
import { queryKeys } from "./query-keys";
import type { LogFilterParams } from "@/lib/types";

export function useLogs(filters: LogFilterParams) {
    return useQuery({
        queryKey: queryKeys.logs.list(filters as Record<string, unknown>),
        queryFn: () => logsApi.list(filters),
        placeholderData: (prev) => prev,
    });
}

export function useLog(id: string | null | undefined) {
    return useQuery({
        queryKey: queryKeys.logs.one(id ?? ""),
        queryFn: () => logsApi.get(id!),
        enabled: !!id,
    });
}
