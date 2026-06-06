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
});
