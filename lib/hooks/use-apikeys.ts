"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiKeysApi } from "@/lib/api/apikeys";
import { queryKeys } from "./query-keys";

export function useApiKeys() {
    return useQuery({
        queryKey: queryKeys.apikeys.all(),
        queryFn: apiKeysApi.list,
    });
}

export function useCreateApiKey() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (name: string) => apiKeysApi.create(name),
        onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.apikeys.all() }),
    });
}

export function useDeleteApiKey() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => apiKeysApi.remove(id),
        onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.apikeys.all() }),
    });
}
