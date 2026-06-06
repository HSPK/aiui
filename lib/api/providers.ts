import { fetcher } from "./client";
import type { ModelDTO } from "@/lib/schemas/model";
import type { ProviderCreateInput, ProviderDTO, ProviderUpdateInput } from "@/lib/schemas/provider";

export const providersApi = {
    list: () => fetcher<ProviderDTO[]>("/providers"),
    get: (idOrName: string) => fetcher<ProviderDTO>(`/providers/${encodeURIComponent(idOrName)}`),
    listModels: (idOrName: string) =>
        fetcher<ModelDTO[]>(`/providers/${encodeURIComponent(idOrName)}/models`),
    create: (data: ProviderCreateInput) =>
        fetcher<ProviderDTO>("/providers", { method: "POST", body: JSON.stringify(data) }),
    update: (idOrName: string, data: ProviderUpdateInput) =>
        fetcher<ProviderDTO>(`/providers/${encodeURIComponent(idOrName)}`, {
            method: "PATCH",
            body: JSON.stringify(data),
        }),
    remove: (idOrName: string) =>
        fetcher<null>(`/providers/${encodeURIComponent(idOrName)}`, { method: "DELETE" }),
    /** Clear the in-memory discovery cache; next /models fetch refetches every provider. */
    reload: () => fetcher<null>("/providers/reload", { method: "POST" }),
    /** Probe the provider's /models endpoint. */
    check: (idOrName: string) =>
        fetcher<{ ok: boolean; models?: number; error?: string; latency_ms?: number }>(
            `/providers/${encodeURIComponent(idOrName)}/check`,
            { method: "POST" },
        ),
};
