import "server-only";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "./db";
import { decryptSecret, maskSecret } from "./crypto";
import type { Provider, Model } from "./db/schema";

export function serializeProvider(p: Provider, modelCount?: number) {
    return {
        id: p.id,
        name: p.name,
        provider_name: p.name,
        base_url: p.baseUrl,
        proxy: p.baseUrl,
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

export function serializeModel(m: Model, providerName?: string | null, providerProxy?: string | null) {
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

export function loadProviderApiKey(p: Provider): string | null {
    return decryptSecret(p.apiKeyEncrypted);
}

export function modelCountsByProvider(): Record<string, number> {
    const rows = db
        .select({ providerId: schema.models.providerId, c: sql<number>`count(*)`.as("c") })
        .from(schema.models)
        .groupBy(schema.models.providerId)
        .all();
    const map: Record<string, number> = {};
    for (const r of rows) map[r.providerId] = Number(r.c);
    return map;
}

export function findProviderByIdOrName(idOrName: string) {
    return (
        db.select().from(schema.providers).where(eq(schema.providers.id, idOrName)).get() ||
        db.select().from(schema.providers).where(eq(schema.providers.name, idOrName)).get()
    );
}

export function findModelByIdOrName(idOrName: string) {
    return (
        db.select().from(schema.models).where(eq(schema.models.id, idOrName)).get() ||
        db.select().from(schema.models).where(eq(schema.models.name, idOrName)).get()
    );
}
