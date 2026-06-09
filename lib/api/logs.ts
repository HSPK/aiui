import { defineResource } from "./resource";
import type { Paginated } from "@/lib/schemas/common";
import type { LogDetailDTO, LogFilterParams, LogListItemDTO } from "@/lib/schemas/log";

/** Read-only resource: only list + get are used. */
export const logs = defineResource<
    LogDetailDTO,
    never,
    never,
    LogFilterParams,
    Paginated<LogListItemDTO>
>({
    path: "/logs/generations",
    key: "logs",
    // Logs change as new generations happen, but for the same filter
    // a 30s cache is fine — the user can hit the explicit Refresh
    // button to force a refetch. Stops re-fetching on every nav back
    // to the page within a session.
    staleTime: 30_000,
});
