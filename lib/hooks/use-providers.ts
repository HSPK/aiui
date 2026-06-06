"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { providersApi } from "@/lib/api/providers";
import { queryKeys } from "./query-keys";
import type { ProviderCreateParams, ProviderUpdateParams } from "@/lib/types";

export function useProviders() {
    return useQuery({
        queryKey: queryKeys.providers.all(),
        queryFn: providersApi.list,
    });
}

export function useProvider(idOrName: string | undefined) {
    return useQuery({
        queryKey: queryKeys.providers.one(idOrName ?? ""),
        queryFn: () => providersApi.get(idOrName!),
        enabled: !!idOrName,
    });
}

export function useProviderModels(idOrName: string | undefined) {
    return useQuery({
        queryKey: queryKeys.providers.models(idOrName ?? ""),
        queryFn: () => providersApi.listModels(idOrName!),
        enabled: !!idOrName,
    });
}

export function useInvalidateProviders() {
    const qc = useQueryClient();
    return () => {
        // Cascades to ["providers"], ["providers", *], ["providers", *, "models"].
        qc.invalidateQueries({ queryKey: queryKeys.providers.all() });
        qc.invalidateQueries({ queryKey: queryKeys.models.all() });
    };
}

export function useCreateProvider() {
    const invalidate = useInvalidateProviders();
    return useMutation({
        mutationFn: (data: ProviderCreateParams) => providersApi.create(data),
        onSuccess: invalidate,
    });
}

export function useUpdateProvider() {
    const invalidate = useInvalidateProviders();
    return useMutation({
        mutationFn: ({ idOrName, data }: { idOrName: string; data: ProviderUpdateParams }) =>
            providersApi.update(idOrName, data),
        onSuccess: invalidate,
    });
}

export function useDeleteProvider() {
    const invalidate = useInvalidateProviders();
    return useMutation({
        mutationFn: (idOrName: string) => providersApi.remove(idOrName),
        onSuccess: invalidate,
    });
}

export function useReloadProviders() {
    const invalidate = useInvalidateProviders();
    return useMutation({
        mutationFn: () => providersApi.reload(),
        onSuccess: invalidate,
    });
}
