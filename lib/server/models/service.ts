import "server-only";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { models, providers, type Provider } from "../db/schema";
import {
    discoveredForProvider,
    getDiscoveryStatus,
    listAllDiscovered,
    type DiscoveredModel,
} from "../discovery";
import { findProviderByIdOrName } from "../providers";
import { resolveAdapter, resolveVariantId } from "../adapters";
import "../adapters/register";
import { getCapability } from "../capabilities";
import "../capabilities/register";
import "../api-variants/register";
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

/** Verbatim entry persisted at override creation, or the freshest cached
 *  discovery entry, or null. Requires the discovery cache to be warm
 *  for the relevant provider (callers warm via listAllDiscovered or
 *  discoveredForProvider before invoking). */
function rawForDbModel(model: typeof models.$inferSelect, provider: Provider | undefined): unknown {
    if (model.discoveredMetadata !== null && model.discoveredMetadata !== undefined) {
        return model.discoveredMetadata;
    }
    if (!provider) return null;
    const cached = getDiscoveryStatus(provider.id);
    const hit = cached?.models.find((m) => m.id === model.upstreamModelId);
    return hit?.meta.raw ?? null;
}

/** Re-project the raw entry through the provider's adapter. When raw is
 *  missing entirely we feed `{id}` so the adapter still emits its built-in
 *  defaults (Foundry's accepted/rejected_fields, etc.). */
function metaForDbModel(
    model: typeof models.$inferSelect,
    provider: Provider | undefined,
    raw: unknown,
): NormalizedModelMeta | null {
    if (!provider) return null;
    const adapter = resolveAdapter(provider);
    return adapter.extractModelMeta(raw ?? { id: model.upstreamModelId }, provider);
}

/** Compute the variant id the gateway would dispatch to right now —
 *  combines the model's pin (if any) with the capability preference
 *  chain. Surfaced on the DTO so the admin form seeds its dropdown with
 *  the same value the gateway is using. */
function resolveDisplayVariant(
    model: typeof models.$inferSelect,
    provider: Provider | undefined,
    meta: NormalizedModelMeta | null,
): string | null {
    if (!provider) return null;
    const capability = getCapability(model.type);
    if (!capability) return null;
    try {
        const adapter = resolveAdapter(provider);
        return resolveVariantId(adapter, capability, model, meta);
    } catch {
        return null;
    }
}

/** Synthesize a transient ModelDTO for a discovered upstream model. */
function discoveredToDTO(d: DiscoveredModel, provider: Provider | undefined): ModelDTO & { is_discovered: true } {
    // Build a tiny shim Model so resolveDisplayVariant can drive the
    // same capability + adapter logic as for DB-backed rows. Only the
    // fields resolveVariantId reads need to be present.
    const shim = {
        apiVariantId: null,
        type: d.capability,
        upstreamModelId: d.id,
    } as typeof models.$inferSelect;
    const resolved = resolveDisplayVariant(shim, provider, d.meta);
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
        api_variant_id: null,
        resolved_variant_id: resolved,
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
    // Kick off discovery + the bulk providers fetch BEFORE the DB scan so
    // the network round-trip overlaps with local work. Drizzle is sync via
    // better-sqlite3, so without this overlap discovery would always be on
    // the critical path.
    const discoveredPromise = listAllDiscovered();

    const rows = db.select().from(models).orderBy(models.name).all();
    const allProviders = db.select().from(providers).all();
    const allProvidersById = new Map(allProviders.map((p) => [p.id, p]));

    const discovered = await discoveredPromise;

    const dbModels: ModelDTO[] = rows.map((m) => {
        const p = allProvidersById.get(m.providerId);
        const raw = rawForDbModel(m, p);
        const meta = metaForDbModel(m, p, raw);
        return {
            ...serializeModel(m, p?.name ?? null, p?.baseUrl ?? null, meta, resolveDisplayVariant(m, p, meta)),
            is_discovered: false,
        };
    });

    const seen = new Set(dbModels.map((m) => m.name));
    const synthesized = discovered
        .filter((d) => !seen.has(d.id))
        .map((d) => discoveredToDTO(d, allProvidersById.get(d.provider_id)));

    return [...dbModels, ...synthesized];
}

export async function listModelsForProvider(providerIdOrName: string): Promise<ModelDTO[]> {
    const provider = findProviderByIdOrName(providerIdOrName);
    if (!provider) throw notFound("Provider not found");

    // Overlap discovery with the DB scan.
    const discoveredPromise = discoveredForProvider(provider).catch((err) => {
        console.warn(`[aiui] provider "${provider.name}" discovery failed:`, err);
        return [] as DiscoveredModel[];
    });

    const rows = db.select().from(models)
        .where(eq(models.providerId, provider.id))
        .orderBy(models.name)
        .all();

    const discovered = await discoveredPromise;

    const dbModels: ModelDTO[] = rows.map((m) => {
        const raw = rawForDbModel(m, provider);
        const meta = metaForDbModel(m, provider, raw);
        return {
            ...serializeModel(m, provider.name, provider.baseUrl, meta, resolveDisplayVariant(m, provider, meta)),
            is_discovered: false,
        };
    });
    const seen = new Set(dbModels.map((m) => m.name));

    const synthesized = discovered
        .filter((d) => !seen.has(d.id))
        .map((d) => discoveredToDTO(d, provider));

    return [...dbModels, ...synthesized];
}

export async function getModel(idOrName: string): Promise<ModelDTO> {
    const model = findModelByIdOrName(idOrName);
    if (model) {
        const provider = db.select().from(providers).where(eq(providers.id, model.providerId)).get();
        // Network warmup is only worth doing when the DB row lacks a
        // persisted snapshot — otherwise `rawForDbModel` already has
        // everything it needs and we'd just be paying upstream latency
        // for no UI win.
        if (provider && model.discoveredMetadata == null) {
            try {
                await discoveredForProvider(provider);
            } catch (err) {
                console.warn(`[aiui] provider "${provider.name}" discovery failed:`, err);
            }
        }
        const raw = rawForDbModel(model, provider);
        const meta = metaForDbModel(model, provider, raw);
        return serializeModel(model, provider?.name ?? null, provider?.baseUrl ?? null, meta, resolveDisplayVariant(model, provider, meta));
    }
    // No DB row — fall back to the live discovery union so /models/<name>
    // works for transient discovered entries too.
    const discovered = await listAllDiscovered();
    const hit = discovered.find((d) => d.id === idOrName);
    if (hit) {
        const provider = db.select().from(providers).where(eq(providers.id, hit.provider_id)).get();
        return discoveredToDTO(hit, provider);
    }
    throw notFound("Model not found");
}

export async function createModel(input: ModelCreateInput): Promise<ModelDTO> {
    const name = input.name.trim();
    const providerKey = input.provider_id.trim();
    const upstream = input.upstream_model_id.trim();

    const provider = findProviderByIdOrName(providerKey);
    if (!provider) throw badRequest("Provider not found");

    const existing = db.select().from(models).where(eq(models.name, name)).get();
    if (existing) throw badRequest("Model name already exists");

    // Snapshot the discovery cache when the caller didn't supply a raw
    // entry — promoting a discovered model into an override is the common
    // case and we don't want to lose its metadata.
    let snapshotted = input.discovered_metadata;
    if (snapshotted === undefined || snapshotted === null) {
        const cached = getDiscoveryStatus(provider.id);
        const hit = cached?.models.find((m) => m.id === upstream);
        if (hit) snapshotted = hit.meta.raw ?? null;
    }

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
        apiVariantId: input.api_variant_id?.trim() || null,
        discoveredMetadata: snapshotted ?? null,
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
    if (input.api_variant_id !== undefined) {
        const v = input.api_variant_id?.trim();
        updates.apiVariantId = v ? v : null;
    }
    if (input.discovered_metadata !== undefined) updates.discoveredMetadata = input.discovered_metadata;

    updates.updatedAt = new Date().toISOString();

    db.update(models).set(updates).where(eq(models.id, model.id)).run();
    return getModel(model.id);
}

export async function deleteModel(idOrName: string): Promise<void> {
    const model = findModelByIdOrName(idOrName);
    if (!model) throw notFound("Model not found");
    db.delete(models).where(eq(models.id, model.id)).run();
}
