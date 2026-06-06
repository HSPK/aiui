import { fetcher } from "./client";
import type {
    ModelConfig,
    ProviderConfig,
    ProviderCreateParams,
    ProviderUpdateParams,
} from "@/lib/types";

export const providersApi = {
    list: () => fetcher<ProviderConfig[]>("/providers"),
    get: (idOrName: string) => fetcher<ProviderConfig>(`/providers/${encodeURIComponent(idOrName)}`),
    listModels: (idOrName: string) =>
        fetcher<ModelConfig[]>(`/providers/${encodeURIComponent(idOrName)}/models`),
    create: (data: ProviderCreateParams) =>
        fetcher<ProviderConfig>("/providers", { method: "POST", body: JSON.stringify(data) }),
    update: (idOrName: string, data: ProviderUpdateParams) =>
        fetcher<ProviderConfig>(`/providers/${encodeURIComponent(idOrName)}`, {
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
