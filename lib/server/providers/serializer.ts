import "server-only";
import { maskSecret } from "../crypto";
import type { Provider } from "../db/schema";
import type { ProviderDTO } from "@/lib/schemas/provider";

export function serializeProvider(p: Provider, modelCount?: number): ProviderDTO {
    return {
        id: p.id,
        name: p.name,
        provider_name: p.name,
        adapter_id: p.adapterId,
        base_url: p.baseUrl,
        proxy: p.baseUrl,
        api_version: p.apiVersion ?? null,
        has_api_key: !!p.apiKeyEncrypted,
        api_key_mask: maskSecret(p.apiKeyEncrypted),
        default_params: (p.defaultParams ?? {}) as Record<string, unknown>,
        http_proxy: p.httpProxy ?? null,
        document_page: p.documentPage ?? "",
        model_page: p.modelPage ?? "",
        health_check_url: p.healthCheckUrl ?? null,
        last_health_status: p.lastHealthStatus ?? null,
        last_health_checked_at: p.lastHealthCheckedAt ?? null,
        last_health_error: p.lastHealthError ?? null,
        is_local: !!p.isLocal,
        enabled: !!p.enabled,
        n_models: modelCount,
        created_at: p.createdAt,
        updated_at: p.updatedAt,
    };
}
