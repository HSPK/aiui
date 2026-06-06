import { defineResource } from "./resource";
import type { CapabilityDTO } from "@/lib/schemas/capability";

/** Read-only catalog. */
export const capabilities = defineResource<
    CapabilityDTO,
    never,
    never,
    Record<string, unknown>,
    CapabilityDTO[]
>({
    path: "/capabilities",
    key: "capabilities",
    listShape: "array",
    staleTime: 60_000,
});
