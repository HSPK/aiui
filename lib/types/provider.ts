export interface ProviderConfig {
    proxy: string;
    provider_name: string;
    model_page: string;
    document_page: string;
    default_params: Record<string, any>;
    http_proxy?: Record<string, string> | null;
    is_local: boolean;
    n_models?: number;
}
