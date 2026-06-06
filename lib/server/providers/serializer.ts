import "server-only";
import { maskSecret } from "../crypto";
import type { Provider } from "../db/schema";
import type { ProviderDTO } from "@/lib/schemas/provider";

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

// Re-export the DTO type so callers can `from "@/lib/server/providers"`.
export type { ProviderDTO } from "@/lib/schemas/provider";
