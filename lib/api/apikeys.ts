import { defineResource } from "./resource";
import type { ApiKeyCreatedDTO, ApiKeyDTO } from "@/lib/schemas/apikey";

/** API keys have a custom create response (returns the plain key once). */
const base = defineResource<
    ApiKeyDTO,
    { name: string },
    never,
    Record<string, unknown>,
    ApiKeyDTO[]
>({
    path: "/apikeys",
    key: "apikeys",
    listShape: "array",
});

export const apiKeys = {
    ...base,
    create: (name: string) =>
        base.create({ name }) as unknown as Promise<ApiKeyCreatedDTO>,
};
