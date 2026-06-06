import { fetcher, withQuery } from "./client";
import type { Paginated } from "@/lib/schemas/common";
import type { LogDetailDTO, LogFilterParams, LogListItemDTO } from "@/lib/schemas/log";

export const logsApi = {
    list: (params: LogFilterParams = {}) =>
        fetcher<Paginated<LogListItemDTO>>(withQuery("/logs/generations", { ...params })),
    get: (id: string) =>
        fetcher<LogDetailDTO>(`/logs/generations/${encodeURIComponent(id)}`),
};
