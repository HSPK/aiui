export type ProviderType = "openai" | "azure";

export interface ProviderConfig {
    id: string;
    name: string;
    provider_name: string;
    type: ProviderType;
    base_url: string;
    proxy: string;
    api_version?: string | null;
    api_key_mask?: string;
    has_api_key: boolean;
    default_params: Record<string, unknown>;
    http_proxy?: Record<string, string> | null;
    document_page?: string;
    model_page?: string;
    is_local: boolean;
    enabled: boolean;
    n_models?: number;
    created_at?: string;
    updated_at?: string;
}

export interface ProviderCreateParams {
    name: string;
    type?: ProviderType;
    base_url: string;
    api_version?: string | null;
    api_key?: string;
    default_params?: Record<string, unknown>;
    http_proxy?: Record<string, string> | null;
    document_page?: string;
    model_page?: string;
    is_local?: boolean;
    enabled?: boolean;
}

export type ProviderUpdateParams = Partial<ProviderCreateParams>;
