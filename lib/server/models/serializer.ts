import "server-only";
import type { Model } from "../db/schema";

export interface ModelDTO {
    id: string;
    name: string;
    model_id: string;
    proxy: string | null;
    timeout: number;
    max_retries: number;
    http_proxy: Record<string, string> | null;
    default_params: Record<string, unknown>;
    type: string;
    pricing: Record<string, unknown> | null;
    output_dimension: number | null;
    context_window: number | null;
    max_tokens: number | null;
    description: string | null;
    knowledge_date: string | null;
    provider: string | null;
    provider_id: string;
    is_local: boolean;
    enabled: boolean;
    is_discovered?: boolean;
    created_at?: string;
    updated_at?: string;
}

export function serializeModel(m: Model, providerName?: string | null, providerProxy?: string | null): ModelDTO {
    return {
        id: m.id,
        name: m.name,
        model_id: m.upstreamModelId,
        proxy: providerProxy ?? null,
        timeout: m.timeout,
        max_retries: m.maxRetries,
        http_proxy: m.httpProxy ?? null,
        default_params: (m.defaultParams ?? {}) as Record<string, unknown>,
        type: m.type,
        pricing: m.pricing ?? null,
        output_dimension: m.outputDimension ?? null,
        context_window: m.contextWindow ?? null,
        max_tokens: m.maxTokens ?? null,
        description: m.description ?? null,
        knowledge_date: m.knowledgeDate ?? null,
        provider: providerName ?? null,
        provider_id: m.providerId,
        is_local: false,
        enabled: !!m.enabled,
        created_at: m.createdAt,
        updated_at: m.updatedAt,
    };
}
