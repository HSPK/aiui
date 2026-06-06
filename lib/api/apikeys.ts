import { fetcher } from "./client";
import type { ApiKeyCreatedDTO, ApiKeyDTO } from "@/lib/schemas/apikey";

export const apiKeysApi = {
    list: () => fetcher<ApiKeyDTO[]>("/apikeys"),
    create: (name: string) =>
        fetcher<ApiKeyCreatedDTO>("/apikeys", {
            method: "POST",
            body: JSON.stringify({ name }),
        }),
    remove: (id: string) =>
        fetcher<null>(`/apikeys/${encodeURIComponent(id)}`, { method: "DELETE" }),
};
