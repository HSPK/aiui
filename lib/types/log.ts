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
    prompt_tokens?: number | null;
    completion_tokens?: number | null;
    total_tokens?: number | null;
    latency_ms?: number | null;
}

export interface GenerationLogDetail extends GenerationLog {
    content: unknown;
    generation_kwargs: Record<string, unknown>;
    generation: Record<string, unknown> | null;
    conversation_id?: string;
    message_id?: string;
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
