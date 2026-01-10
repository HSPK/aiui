export interface GenerationLog {
    id: string;
    created_at: string;
    updated_at: string;
    is_deleted: boolean;
    status: "pending" | "completed" | "failed";
    user_id: string;
    model_name: string;
    input: string;
    output: string;
    reason: string | null;
}

export interface GenerationLogDetail extends GenerationLog {
    content: any; // Can be string or list of messages
    generation_kwargs: Record<string, any>;
    generation: any; // Detailed generation info
}

export interface LogFilterParams {
    page?: number;
    page_size?: number;
    sort?: string;
    user_id?: string | null;
    model_name?: string | null;
    status?: "pending" | "completed" | "failed" | null;
}

export interface LogListResponse {
    items: GenerationLog[];
    total: number;
    page: number;
    page_size: number;
}
