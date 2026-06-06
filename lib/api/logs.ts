import { fetcher, withQuery } from "./client";
import type {
    GenerationLogDetail,
    LogFilterParams,
    LogListResponse,
} from "@/lib/types";

export const logsApi = {
    list: (params: LogFilterParams = {}) =>
        fetcher<LogListResponse>(withQuery("/logs/generations", { ...params })),
    get: (id: string) =>
        fetcher<GenerationLogDetail>(`/logs/generations/${encodeURIComponent(id)}`),
};
