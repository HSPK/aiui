import "server-only";
import { maskSecret } from "../crypto";
import type { Provider } from "../db/schema";

export interface ProviderDTO {
    id: string;
    name: string;
    provider_name: string;
    type: "openai" | "azure";
    base_url: string;
    proxy: string;
    api_version: string | null;
    has_api_key: boolean;
    api_key_mask: string;
    default_params: Record<string, unknown>;
    http_proxy: Record<string, string> | null;
    document_page: string;
    model_page: string;
    is_local: boolean;
    enabled: boolean;
    n_models?: number;
    created_at: string;
    updated_at: string;
}

export function serializeProvider(p: Provider, modelCount?: number): ProviderDTO {
    return {
        id: p.id,
        name: p.name,
        provider_name: p.name,
        type: p.type,
        base_url: p.baseUrl,
        proxy: p.baseUrl,
        api_version: p.apiVersion ?? null,
        has_api_key: !!p.apiKeyEncrypted,
        api_key_mask: maskSecret(p.apiKeyEncrypted),
        default_params: (p.defaultParams ?? {}) as Record<string, unknown>,
        http_proxy: p.httpProxy ?? null,
        document_page: p.documentPage ?? "",
        model_page: p.modelPage ?? "",
        is_local: !!p.isLocal,
        enabled: !!p.enabled,
        n_models: modelCount,
        created_at: p.createdAt,
        updated_at: p.updatedAt,
    };
}
