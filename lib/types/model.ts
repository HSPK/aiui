export interface Pricing {
    input?: number;
    output?: number;
    [key: string]: unknown;
}

export interface ModelConfig {
    id: string;
    name: string;
    model_id?: string | null;
    proxy?: string | null;
    timeout: number;
    max_retries: number;
    http_proxy?: Record<string, string> | null;
    default_params: Record<string, unknown>;
    type: "chat" | "embedding" | "audio" | "reranker";
    pricing?: Pricing | null;
    output_dimension?: number | null;
    context_window?: number | null;
    max_tokens?: number | null;
    description?: string | null;
    knowledge_date?: string | null;
    provider?: string | null;
    provider_id?: string | null;
    is_local: boolean;
    enabled: boolean;
    is_discovered?: boolean;
    created_at?: string;
    updated_at?: string;
}

export interface ModelCreateParams {
    name: string;
    provider_id: string;
    upstream_model_id: string;
    type?: "chat" | "embedding" | "audio" | "reranker";
    default_params?: Record<string, unknown>;
    context_window?: number | null;
    max_tokens?: number | null;
    output_dimension?: number | null;
    pricing?: Pricing | null;
    description?: string | null;
    knowledge_date?: string | null;
    timeout?: number;
    max_retries?: number;
    http_proxy?: Record<string, string> | null;
    enabled?: boolean;
}

export type ModelUpdateParams = Partial<ModelCreateParams>;
