"use client";
import { useMutation, useQuery, useQueryClient, type UseMutationOptions } from "@tanstack/react-query";
import { defineResource } from "./resource";
import { fetcher } from "./client";
import type { ModelDTO } from "@/lib/schemas/model";
import type { ProviderCreateInput, ProviderDTO, ProviderUpdateInput } from "@/lib/schemas/provider";

const base = defineResource<
    ProviderDTO,
    ProviderCreateInput,
    ProviderUpdateInput,
    Record<string, unknown>,
    ProviderDTO[]
>({
    path: "/providers",
    key: "providers",
    listShape: "array",
    invalidates: ["models"],
});

export interface ProviderCheckResult {
    ok: boolean;
    models?: number;
    error?: string;
    latency_ms?: number;
}

export interface ProviderProbeResult {
    ok: boolean;
    error?: string;
    latency_ms: number;
}

export const providers = {
    ...base,

    // ---- custom endpoints ----
    listModels: (id: string) =>
        fetcher<ModelDTO[]>(`/providers/${encodeURIComponent(id)}/models`),
    reload: () =>
        fetcher<null>("/providers/reload", { method: "POST" }),
    check: (id: string) =>
        fetcher<ProviderCheckResult>(
            `/providers/${encodeURIComponent(id)}/check`,
            { method: "POST" },
        ),
    /** Probe an arbitrary health-check URL without touching any saved
     *  provider — used by the form's Test button so it validates the
     *  URL currently in the input, not the (possibly stale) saved one. */
    probe: (healthCheckUrl: string) =>
        fetcher<ProviderProbeResult>("/providers/probe", {
            method: "POST",
            body: JSON.stringify({ health_check_url: healthCheckUrl }),
            headers: { "Content-Type": "application/json" },
        }),

    // ---- custom hooks ----
    useModels: (id: string | undefined | null) =>
        useQuery({
            queryKey: [...base.keys.one(id ?? ""), "models"] as const,
            queryFn: () => providers.listModels(id!),
            enabled: !!id,
        }),

    /** POST /providers/reload — clears the discovery cache. Cascades same
     *  invalidation as a CRUD mutation (providers + models). */
    useReload: (opts?: Omit<UseMutationOptions<null, Error, void>, "mutationFn">) => {
        const invalidate = base.useInvalidate();
        return useMutation<null, Error, void>({
            mutationFn: providers.reload,
            ...opts,
            onSuccess: (data, vars, onMutateResult, context) => {
                invalidate();
                opts?.onSuccess?.(data, vars, onMutateResult, context);
            },
        });
    },

    /** POST /providers/:id/check — runs the health probe. On success the
     *  server has updated `last_health_*`, so we invalidate the providers
     *  cache to surface the new status pill. */
    useCheck: (
        id: string | undefined | null,
        opts?: Omit<UseMutationOptions<ProviderCheckResult, Error, void>, "mutationFn">,
    ) => {
        const invalidate = base.useInvalidate();
        return useMutation<ProviderCheckResult, Error, void>({
            mutationFn: () => providers.check(id!),
            ...opts,
            onSuccess: (data, vars, onMutateResult, context) => {
                invalidate();
                opts?.onSuccess?.(data, vars, onMutateResult, context);
            },
        });
    },
};
