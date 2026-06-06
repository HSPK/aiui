"use client";
import { useQuery } from "@tanstack/react-query";
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

export const providers = {
    ...base,

    // ---- custom endpoints ----
    listModels: (id: string) =>
        fetcher<ModelDTO[]>(`/providers/${encodeURIComponent(id)}/models`),
    reload: () =>
        fetcher<null>("/providers/reload", { method: "POST" }),
    check: (id: string) =>
        fetcher<{ ok: boolean; models?: number; error?: string; latency_ms?: number }>(
            `/providers/${encodeURIComponent(id)}/check`,
            { method: "POST" },
        ),

    // ---- custom hooks ----
    useModels: (id: string | undefined | null) =>
        useQuery({
            queryKey: ["providers", id ?? "", "models"] as const,
            queryFn: () => providers.listModels(id!),
            enabled: !!id,
        }),
};
