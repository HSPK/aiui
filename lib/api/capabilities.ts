import { fetcher } from "./client";
import type { Capability } from "@/lib/types";

export const capabilitiesApi = {
    list: () => fetcher<Capability[]>("/capabilities"),
};
