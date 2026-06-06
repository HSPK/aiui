import { fetcher } from "./client";
import type { ModelConfig, ModelCreateParams, ModelUpdateParams } from "@/lib/types";

export const modelsApi = {
    list: () => fetcher<ModelConfig[]>("/models"),
    get: (idOrName: string) => fetcher<ModelConfig>(`/models/${encodeURIComponent(idOrName)}`),
    create: (data: ModelCreateParams) =>
        fetcher<ModelConfig>("/models", { method: "POST", body: JSON.stringify(data) }),
    update: (idOrName: string, data: ModelUpdateParams) =>
        fetcher<ModelConfig>(`/models/${encodeURIComponent(idOrName)}`, {
            method: "PATCH",
            body: JSON.stringify(data),
        }),
    remove: (idOrName: string) =>
        fetcher<null>(`/models/${encodeURIComponent(idOrName)}`, { method: "DELETE" }),
};
