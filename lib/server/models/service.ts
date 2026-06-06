import "server-only";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { models, providers, type Provider } from "../db/schema";
import { discoverModels, listAllDiscovered, type DiscoveredModel } from "../discovery";
import { findProviderByIdOrName } from "../providers";
import { resolveAdapter } from "../adapters";
import "../adapters/register";
import { badRequest, notFound } from "../response";
import { serializeModel } from "./serializer";
import type { ModelDTO } from "@/lib/schemas/model";
import type { ModelCreateInput, ModelUpdateInput } from "@/lib/schemas/model";
import type { NormalizedModelMeta } from "@/lib/schemas/adapter";

export function findModelByIdOrName(idOrName: string) {
    return (
        db.select().from(models).where(eq(models.id, idOrName)).get() ||
        db.select().from(models).where(eq(models.name, idOrName)).get()
    );
}

/** Re-project the stored discovered metadata for a DB-backed model row,
 *  returning a fresh NormalizedModelMeta if discovery has recorded one. */
function metaForDbModel(model: typeof models.$inferSelect, provider: Provider | undefined): NormalizedModelMeta | null {
    if (!provider || !model.discoveredMetadata) return null;
    const adapter = resolveAdapter(provider);
    return adapter.extractModelMeta(model.discoveredMetadata, provider);
}

/** Synthesize a transient ModelDTO for a discovered upstream model. */
function discoveredToDTO(d: DiscoveredModel, provider: Provider | undefined): ModelDTO & { is_discovered: true } {
    return {
        id: `discovered:${d.provider_id}:${d.id}`,
        name: d.id,
        model_id: d.id,
        proxy: provider?.baseUrl ?? null,
        timeout: 60,
        max_retries: 2,
        http_proxy: null,
        default_params: {},
        type: d.capability,
        pricing: null,
        output_dimension: null,
        context_window: d.meta.context_window ?? null,
        max_tokens: d.meta.max_output_tokens ?? null,
        description: null,
        knowledge_date: null,
        provider: provider?.name ?? d.provider_name,
        provider_id: d.provider_id,
        is_local: false,
        enabled: true,
        meta: d.meta,
        created_at: undefined,
        updated_at: undefined,
        is_discovered: true,
    };
}

/** List all DB-backed override rows plus live discovered models (union, DB shadows discovery). */
export async function listAllModels(): Promise<ModelDTO[]> {
    const rows = db.select().from(models).orderBy(models.name).all();
    const providerIds = Array.from(new Set(rows.map((r) => r.providerId)));
    const providerRows = providerIds.length > 0
        ? db.select().from(providers).where(inArray(providers.id, providerIds)).all()
        : [];
    const providerMap = new Map(providerRows.map((p) => [p.id, p]));

    const dbModels: ModelDTO[] = rows.map((m) => {
        const p = providerMap.get(m.providerId);
        return {
            ...serializeModel(m, p?.name ?? null, p?.baseUrl ?? null, metaForDbModel(m, p)),
            is_discovered: false,
        };
    });

    const seen = new Set(dbModels.map((m) => m.name));
    const allProviders = db.select().from(providers).all();
    const allProvidersById = new Map(allProviders.map((p) => [p.id, p]));
    const discovered = await listAllDiscovered();
    const synthesized = discovered
        .filter((d) => !seen.has(d.id))
        .map((d) => discoveredToDTO(d, allProvidersById.get(d.provider_id)));

    return [...dbModels, ...synthesized];
}

export async function listModelsForProvider(providerIdOrName: string): Promise<ModelDTO[]> {
    const provider = findProviderByIdOrName(providerIdOrName);
    if (!provider) throw notFound("Provider not found");

    const rows = db.select().from(models)
        .where(eq(models.providerId, provider.id))
        .orderBy(models.name)
        .all();
    const dbModels: ModelDTO[] = rows.map((m) => ({
        ...serializeModel(m, provider.name, provider.baseUrl, metaForDbModel(m, provider)),
        is_discovered: false,
    }));
    const seen = new Set(dbModels.map((m) => m.name));

    let discovered: DiscoveredModel[] = [];
    try {
        discovered = await discoverModels(provider);
    } catch (err) {
        console.warn(`[aiui] provider "${provider.name}" discovery failed:`, err);
    }
    const synthesized = discovered
        .filter((d) => !seen.has(d.id))
        .map((d) => discoveredToDTO(d, provider));

    return [...dbModels, ...synthesized];
}

export async function getModel(idOrName: string): Promise<ModelDTO> {
    const model = findModelByIdOrName(idOrName);
    if (!model) throw notFound("Model not found");
    const provider = db.select().from(providers).where(eq(providers.id, model.providerId)).get();
    return serializeModel(model, provider?.name ?? null, provider?.baseUrl ?? null, metaForDbModel(model, provider));
}

export async function createModel(input: ModelCreateInput): Promise<ModelDTO> {
    const name = input.name.trim();
    const providerKey = input.provider_id.trim();
    const upstream = input.upstream_model_id.trim();

    const provider = findProviderByIdOrName(providerKey);
    if (!provider) throw badRequest("Provider not found");

    const existing = db.select().from(models).where(eq(models.name, name)).get();
    if (existing) throw badRequest("Model name already exists");

    const id = randomUUID();
    db.insert(models).values({
        id,
        name,
        providerId: provider.id,
        upstreamModelId: upstream,
        type: input.type ?? "chat",
        defaultParams: input.default_params ?? {},
        contextWindow: input.context_window ?? null,
        maxTokens: input.max_tokens ?? null,
        outputDimension: input.output_dimension ?? null,
        pricing: input.pricing ?? null,
        description: input.description ?? null,
        knowledgeDate: input.knowledge_date ?? null,
        timeout: input.timeout ?? 60,
        maxRetries: input.max_retries ?? 2,
        httpProxy: input.http_proxy ?? null,
        enabled: input.enabled ?? true,
    }).run();

    return getModel(id);
}

export async function updateModel(idOrName: string, input: ModelUpdateInput): Promise<ModelDTO> {
    const model = findModelByIdOrName(idOrName);
    if (!model) throw notFound("Model not found");

    const updates: Partial<typeof models.$inferInsert> = {};

    if (input.name !== undefined) {
        const newName = input.name.trim();
        if (!newName) throw badRequest("Model name cannot be empty");
        if (newName !== model.name) {
            const dup = db.select().from(models).where(eq(models.name, newName)).get();
            if (dup) throw badRequest("Model name already exists");
            updates.name = newName;
        }
    }
    if (input.provider_id !== undefined) {
        const provider = findProviderByIdOrName(input.provider_id);
        if (!provider) throw badRequest("Provider not found");
        updates.providerId = provider.id;
    }
    if (input.upstream_model_id !== undefined) {
        const v = input.upstream_model_id.trim();
        if (!v) throw badRequest("upstream_model_id cannot be empty");
        updates.upstreamModelId = v;
    }
    if (input.type !== undefined) updates.type = input.type;
    if (input.default_params !== undefined) updates.defaultParams = input.default_params ?? {};
    if (input.context_window !== undefined) updates.contextWindow = input.context_window;
    if (input.max_tokens !== undefined) updates.maxTokens = input.max_tokens;
    if (input.output_dimension !== undefined) updates.outputDimension = input.output_dimension;
    if (input.pricing !== undefined) updates.pricing = input.pricing;
    if (input.description !== undefined) updates.description = input.description;
    if (input.knowledge_date !== undefined) updates.knowledgeDate = input.knowledge_date;
    if (input.timeout !== undefined) updates.timeout = input.timeout;
    if (input.max_retries !== undefined) updates.maxRetries = input.max_retries;
    if (input.http_proxy !== undefined) updates.httpProxy = input.http_proxy ?? null;
    if (input.enabled !== undefined) updates.enabled = !!input.enabled;

    updates.updatedAt = new Date().toISOString();

    db.update(models).set(updates).where(eq(models.id, model.id)).run();
    return getModel(model.id);
}

export async function deleteModel(idOrName: string): Promise<void> {
    const model = findModelByIdOrName(idOrName);
    if (!model) throw notFound("Model not found");
    db.delete(models).where(eq(models.id, model.id)).run();
}
