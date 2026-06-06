import { fetcher } from "./client";
import type { CapabilityDTO } from "@/lib/schemas/capability";

export const capabilitiesApi = {
    list: () => fetcher<CapabilityDTO[]>("/capabilities"),
};
