import "server-only";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { models, providers } from "../db/schema";
import { decryptSecret, encryptSecret } from "../crypto";
import { badRequest, notFound } from "../response";
import { clearDiscoveryCache, discoveredCountByProvider } from "../discovery";
import { serializeProvider, type ProviderDTO } from "./serializer";
import type { ProviderCreateInput, ProviderUpdateInput } from "./schemas";
import type { Provider } from "../db/schema";

/** DB-only count of models per provider (excludes discovered). */
function dbModelCounts(): Record<string, number> {
    const rows = db
        .select({ providerId: models.providerId, c: sql<number>`count(*)`.as("c") })
        .from(models)
        .groupBy(models.providerId)
        .all();
    const map: Record<string, number> = {};
    for (const r of rows) map[r.providerId] = Number(r.c);
    return map;
}

export function findProviderByIdOrName(idOrName: string): Provider | undefined {
    return (
        db.select().from(providers).where(eq(providers.id, idOrName)).get() ||
        db.select().from(providers).where(eq(providers.name, idOrName)).get()
    );
}

export function loadProviderApiKey(p: Provider): string | null {
    return decryptSecret(p.apiKeyEncrypted);
}

export async function listProviders(): Promise<ProviderDTO[]> {
    const rows = db.select().from(providers).orderBy(providers.name).all();
    const dbCounts = dbModelCounts();
    const discoveredCounts = await discoveredCountByProvider();
    return rows.map((p) => serializeProvider(p, (dbCounts[p.id] ?? 0) + (discoveredCounts[p.id] ?? 0)));
}

export async function getProvider(idOrName: string): Promise<ProviderDTO> {
    const provider = findProviderByIdOrName(idOrName);
    if (!provider) throw notFound("Provider not found");
    const dbCounts = dbModelCounts();
    const discoveredCounts = await discoveredCountByProvider();
    const total = (dbCounts[provider.id] ?? 0) + (discoveredCounts[provider.id] ?? 0);
    return serializeProvider(provider, total);
}

export async function createProvider(input: ProviderCreateInput): Promise<ProviderDTO> {
    const name = input.name.trim();
    const baseUrl = input.base_url.trim();
    const type = input.type === "azure" ? "azure" : "openai";

    const dup = db.select().from(providers).where(eq(providers.name, name)).get();
    if (dup) throw badRequest("Provider name already exists");

    const id = randomUUID();
    db.insert(providers).values({
        id,
        name,
        type,
        baseUrl,
        apiVersion: input.api_version?.trim() || null,
        apiKeyEncrypted: encryptSecret(input.api_key ?? null),
        defaultParams: input.default_params ?? {},
        httpProxy: input.http_proxy ?? null,
        documentPage: input.document_page ?? null,
        modelPage: input.model_page ?? null,
        isLocal: !!input.is_local,
        enabled: input.enabled ?? true,
    }).run();
    clearDiscoveryCache();

    return getProvider(id);
}

export async function updateProvider(idOrName: string, input: ProviderUpdateInput): Promise<ProviderDTO> {
    const provider = findProviderByIdOrName(idOrName);
    if (!provider) throw notFound("Provider not found");

    const updates: Partial<typeof providers.$inferInsert> = {};

    if (input.name !== undefined) {
        const newName = input.name.trim();
        if (!newName) throw badRequest("Provider name cannot be empty");
        if (newName !== provider.name) {
            const dup = db.select().from(providers).where(eq(providers.name, newName)).get();
            if (dup) throw badRequest("Provider name already exists");
            updates.name = newName;
        }
    }
    if (input.type !== undefined) updates.type = input.type === "azure" ? "azure" : "openai";
    if (input.base_url !== undefined) {
        const newUrl = input.base_url.trim();
        if (!newUrl) throw badRequest("base_url cannot be empty");
        updates.baseUrl = newUrl;
    }
    if (input.api_version !== undefined) updates.apiVersion = input.api_version?.trim() || null;
    if (input.api_key !== undefined) {
        updates.apiKeyEncrypted = input.api_key ? encryptSecret(input.api_key) : null;
    }
    if (input.default_params !== undefined) updates.defaultParams = input.default_params ?? {};
    if (input.http_proxy !== undefined) updates.httpProxy = input.http_proxy ?? null;
    if (input.document_page !== undefined) updates.documentPage = input.document_page;
    if (input.model_page !== undefined) updates.modelPage = input.model_page;
    if (input.is_local !== undefined) updates.isLocal = !!input.is_local;
    if (input.enabled !== undefined) updates.enabled = !!input.enabled;

    updates.updatedAt = new Date().toISOString();

    db.update(providers).set(updates).where(eq(providers.id, provider.id)).run();
    clearDiscoveryCache();
    return getProvider(provider.id);
}

export async function deleteProvider(idOrName: string): Promise<void> {
    const provider = findProviderByIdOrName(idOrName);
    if (!provider) throw notFound("Provider not found");
    db.delete(providers).where(eq(providers.id, provider.id)).run();
    clearDiscoveryCache();
}

export async function checkProvider(idOrName: string): Promise<{ ok: boolean; models?: number; error?: string; latency_ms?: number }> {
    const provider = findProviderByIdOrName(idOrName);
    if (!provider) throw notFound("Provider not found");

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const key = decryptSecret(provider.apiKeyEncrypted);

    let url: string;
    if (provider.type === "azure") {
        if (key) headers["api-key"] = key;
        const apiVersion = provider.apiVersion?.trim() || "2024-10-21";
        url = `${provider.baseUrl.replace(/\/$/, "")}/openai/models?api-version=${encodeURIComponent(apiVersion)}`;
    } else {
        if (key) headers["Authorization"] = `Bearer ${key}`;
        url = `${provider.baseUrl.replace(/\/$/, "")}/models`;
    }

    const start = Date.now();
    try {
        const res = await fetch(url, { headers });
        const ms = Date.now() - start;
        if (!res.ok) {
            const text = await res.text().catch(() => res.statusText);
            return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}`, latency_ms: ms };
        }
        const json = (await res.json().catch(() => null)) as { data?: unknown[] } | null;
        const models = Array.isArray(json?.data) ? json!.data.length : undefined;
        return { ok: true, models, latency_ms: ms };
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, error: msg };
    }
}
