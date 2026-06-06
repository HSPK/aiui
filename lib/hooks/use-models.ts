"use client";
import { useQuery, useMutation } from "@tanstack/react-query";
import { modelsApi } from "@/lib/api/models";
import { capabilitiesApi } from "@/lib/api/capabilities";
import { queryKeys } from "./query-keys";
import { useInvalidateProviders } from "./use-providers";
import type { ModelCreateInput, ModelUpdateInput } from "@/lib/schemas/model";

export function useModels() {
    return useQuery({
        queryKey: queryKeys.models.all(),
        queryFn: modelsApi.list,
    });
}

export function useCapabilities() {
    return useQuery({
        queryKey: queryKeys.capabilities.all(),
        queryFn: capabilitiesApi.list,
        staleTime: 60_000,
    });
}

export function useCreateModel() {
    const invalidate = useInvalidateProviders();
    return useMutation({
        mutationFn: (data: ModelCreateInput) => modelsApi.create(data),
        onSuccess: invalidate,
    });
}

export function useUpdateModel() {
    const invalidate = useInvalidateProviders();
    return useMutation({
        mutationFn: ({ idOrName, data }: { idOrName: string; data: ModelUpdateInput }) =>
            modelsApi.update(idOrName, data),
        onSuccess: invalidate,
    });
}

export function useDeleteModel() {
    const invalidate = useInvalidateProviders();
    return useMutation({
        mutationFn: (idOrName: string) => modelsApi.remove(idOrName),
        onSuccess: invalidate,
    });
}
