import { fetcher } from "./client";
import type { ApiKey } from "@/lib/types";

export const apiKeysApi = {
    list: () => fetcher<ApiKey[]>("/apikeys"),
    create: (name: string) =>
        fetcher<ApiKey & { key: string }>("/apikeys", {
            method: "POST",
            body: JSON.stringify({ name }),
        }),
    remove: (id: string) =>
        fetcher<null>(`/apikeys/${encodeURIComponent(id)}`, { method: "DELETE" }),
};
