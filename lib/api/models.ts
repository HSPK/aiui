import { fetcher } from "./client";
import type { ModelCreateInput, ModelDTO, ModelUpdateInput } from "@/lib/schemas/model";

export const modelsApi = {
    list: () => fetcher<ModelDTO[]>("/models"),
    get: (idOrName: string) => fetcher<ModelDTO>(`/models/${encodeURIComponent(idOrName)}`),
    create: (data: ModelCreateInput) =>
        fetcher<ModelDTO>("/models", { method: "POST", body: JSON.stringify(data) }),
    update: (idOrName: string, data: ModelUpdateInput) =>
        fetcher<ModelDTO>(`/models/${encodeURIComponent(idOrName)}`, {
            method: "PATCH",
            body: JSON.stringify(data),
        }),
    remove: (idOrName: string) =>
        fetcher<null>(`/models/${encodeURIComponent(idOrName)}`, { method: "DELETE" }),
};
