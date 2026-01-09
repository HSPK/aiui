export interface Pricing {
    [key: string]: any; // Placeholder until refined
}

export interface ModelConfig {
    name: string;
    proxy?: string | null;
    model_id?: string | null;
    timeout: number;
    max_retries: number;
    http_proxy?: Record<string, string> | null;
    default_params: Record<string, any>;
    type: "chat" | "embedding" | "audio" | "reranker";
    pricing?: Pricing | null;
    output_dimension?: number | null;
    context_window?: number | null;
    max_tokens?: number | null;
    description?: string | null;
    knowledge_date?: string | null;
    provider?: string | null;
    is_local: boolean;
}
