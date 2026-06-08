import { defineResource } from "./resource";
import type { VariantDescriptor } from "@/lib/schemas/variant";

/** Read-only catalog of registered upstream API variants. */
export const variants = defineResource<
    VariantDescriptor,
    never,
    never,
    Record<string, unknown>,
    VariantDescriptor[]
>({
    path: "/variants",
    key: "variants",
    listShape: "array",
    staleTime: 60_000,
});
