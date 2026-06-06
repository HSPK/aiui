import { defineResource } from "./resource";
import type { AdapterDescriptor } from "@/lib/schemas/adapter";

/** Read-only catalog of registered ProviderAdapter ids. */
export const adapters = defineResource<
    AdapterDescriptor,
    never,
    never,
    Record<string, unknown>,
    AdapterDescriptor[]
>({
    path: "/adapters",
    key: "adapters",
    listShape: "array",
    staleTime: 60_000,
});
