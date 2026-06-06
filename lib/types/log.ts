import type {
    LogDetailDTO,
    LogListItemDTO,
    LogStatus,
} from "@/lib/schemas/log";
import type { Paginated } from "@/lib/schemas/common";

export type GenerationLog = LogListItemDTO;
export type GenerationLogDetail = LogDetailDTO;
export type LogListResponse = Paginated<GenerationLog>;
export type LogStatusType = LogStatus;

/** Query params for the log list page (all optional in the UI, `null` clears). */
export type LogFilterParams = {
    page?: number;
    page_size?: number;
    sort?: string;
    user_id?: string | null;
    model_name?: string | null;
    capability?: string | null;
    status?: LogStatus | null;
};
