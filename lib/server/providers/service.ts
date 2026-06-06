import "server-only";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { models, providers } from "../db/schema";
import { decryptSecret, encryptSecret } from "../crypto";
import { badRequest, notFound } from "../response";
import { clearDiscoveryCache, discoverModels, discoveredCountByProvider } from "../discovery";
import { resolveAdapter } from "../adapters";
import "../adapters/register";
import { serializeProvider } from "./serializer";
import type { ProviderDTO } from "@/lib/schemas/provider";
import type { ProviderCreateInput, ProviderUpdateInput } from "@/lib/schemas/provider";
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

/**
 * Resolve the adapter id for a (about-to-be-persisted) provider. Falls
 * back to the registry's `matches()` pass when the caller didn't pick
 * one explicitly. Built so we never persist an empty `adapter_id`.
 */
function resolveAdapterId(input: { adapter_id?: string; base_url: string; api_version?: string | null }): string {
    if (input.adapter_id && input.adapter_id.trim()) return input.adapter_id.trim();
    // Synthesize a placeholder Provider for the registry's matches() pass.
    const probe: Provider = {
        id: "",
        name: "",
        adapterId: "",
        baseUrl: input.base_url,
        apiVersion: input.api_version ?? null,
        apiKeyEncrypted: null,
        defaultParams: {},
        httpProxy: null,
        documentPage: null,
        modelPage: null,
        healthCheckUrl: null,
        lastHealthStatus: null,
        lastHealthCheckedAt: null,
        lastHealthError: null,
        isLocal: false,
        enabled: true,
        createdAt: "",
        updatedAt: "",
    };
    return resolveAdapter(probe).id;
}

export async function createProvider(input: ProviderCreateInput): Promise<ProviderDTO> {
    const name = input.name.trim();
    const baseUrl = input.base_url.trim();

    const dup = db.select().from(providers).where(eq(providers.name, name)).get();
    if (dup) throw badRequest("Provider name already exists");

    const id = randomUUID();
    const adapterId = resolveAdapterId({ adapter_id: input.adapter_id, base_url: baseUrl, api_version: input.api_version ?? null });

    db.insert(providers).values({
        id,
        name,
        adapterId,
        baseUrl,
        apiVersion: input.api_version?.trim() || null,
        apiKeyEncrypted: encryptSecret(input.api_key ?? null),
        defaultParams: input.default_params ?? {},
        httpProxy: input.http_proxy ?? null,
        documentPage: input.document_page ?? null,
        modelPage: input.model_page ?? null,
        healthCheckUrl: input.health_check_url?.trim() || null,
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
    if (input.adapter_id !== undefined) {
        const a = input.adapter_id?.trim();
        if (!a) throw badRequest("adapter_id cannot be empty");
        updates.adapterId = a;
    }
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
    if (input.health_check_url !== undefined) {
        const newUrl = input.health_check_url?.trim() || null;
        // Whenever the health URL itself changes (or is cleared), wipe the
        // cached status — the previous result was for a different endpoint.
        if (newUrl !== provider.healthCheckUrl) {
            updates.healthCheckUrl = newUrl;
            updates.lastHealthStatus = null;
            updates.lastHealthCheckedAt = null;
            updates.lastHealthError = null;
        }
    }
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

/** Probe an arbitrary health-check URL. Pure I/O — no DB writes. Used
 *  both by `checkProvider` (for the saved URL branch) and by the
 *  `POST /providers/probe` endpoint, which lets the form Test button
 *  validate the URL the user is currently editing before they save. */
export async function probeHealthCheckUrl(
    url: string,
): Promise<{ ok: boolean; error?: string; latency_ms: number }> {
    const start = Date.now();
    try {
        const res = await fetch(url, {
            method: "GET",
            signal: AbortSignal.timeout(10_000),
        });
        const ms = Date.now() - start;
        if (!res.ok) {
            const text = await res.text().catch(() => res.statusText);
            return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}`, latency_ms: ms };
        }
        const json = (await res.json().catch(() => null)) as { status?: unknown } | null;
        if (!json || json.status !== "ok") {
            return {
                ok: false,
                error: `Expected {"status":"ok"}, got ${JSON.stringify(json).slice(0, 200)}`,
                latency_ms: ms,
            };
        }
        return { ok: true, latency_ms: ms };
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, error: msg, latency_ms: Date.now() - start };
    }
}

/**
 * Provider health probe for a saved provider. Two strategies, in
 * priority order:
 *   1. If `provider.healthCheckUrl` is set → call `probeHealthCheckUrl`
 *      and persist the outcome to `last_health_*` so the UI can render
 *      a real status pill without re-probing on every render.
 *   2. Otherwise → fall back to discovery via the resolved adapter,
 *      which returns a model count on success. Discovery probes do NOT
 *      update `last_health_*` (those columns are tied to the explicit
 *      health URL contract).
 */
export async function checkProvider(idOrName: string): Promise<{ ok: boolean; models?: number; error?: string; latency_ms?: number }> {
    const provider = findProviderByIdOrName(idOrName);
    if (!provider) throw notFound("Provider not found");

    if (provider.healthCheckUrl) {
        const result = await probeHealthCheckUrl(provider.healthCheckUrl);
        db.update(providers).set({
            lastHealthStatus: result.ok ? "ok" : "down",
            lastHealthCheckedAt: new Date().toISOString(),
            lastHealthError: result.ok ? null : (result.error ?? null),
            updatedAt: new Date().toISOString(),
        }).where(eq(providers.id, provider.id)).run();
        return result;
    }

    // No dedicated health endpoint — fall back to a discovery probe via
    // the adapter (which handles URL, auth, and shape per upstream).
    const start = Date.now();
    try {
        const models = await discoverModels(provider);
        return { ok: true, models: models.length, latency_ms: Date.now() - start };
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, error: msg, latency_ms: Date.now() - start };
    }
}
