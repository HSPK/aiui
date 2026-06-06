import "server-only";
import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/server/db";
import { ensureInit } from "@/lib/server/init";
import { requireAdmin, requireUser } from "@/lib/server/auth";
import { listAllDiscovered } from "@/lib/server/discovery";
import { badRequest, handle, ok } from "@/lib/server/response";
import { findProviderByIdOrName, serializeModel } from "@/lib/server/serializers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
    try {
        await ensureInit();
        await requireUser();

        // 1) DB-backed overrides (admin-defined, including Azure deployments).
        const rows = db.select().from(schema.models).orderBy(schema.models.name).all();
        const providerIds = Array.from(new Set(rows.map((r) => r.providerId)));
        const providers = providerIds.length > 0
            ? db.select().from(schema.providers).where(inArray(schema.providers.id, providerIds)).all()
            : [];
        const providerMap = new Map(providers.map((p) => [p.id, p]));
        const dbModels = rows.map((m) => {
            const p = providerMap.get(m.providerId);
            return {
                ...serializeModel(m, p?.name ?? null, p?.baseUrl ?? null),
                is_discovered: false,
            };
        });

        // 2) Live-discovered models from each enabled provider. Skip names that
        //    already have an explicit DB row — the override wins.
        const seen = new Set(dbModels.map((m) => m.name));
        const allProviders = db.select().from(schema.providers).all();
        const providerById = new Map(allProviders.map((p) => [p.id, p]));
        const discovered = await listAllDiscovered();
        const synthesized = discovered
            .filter((d) => !seen.has(d.id))
            .map((d) => {
                const p = providerById.get(d.provider_id);
                seen.add(d.id);
                return {
                    id: `discovered:${d.provider_id}:${d.id}`,
                    name: d.id,
                    model_id: d.id,
                    proxy: p?.baseUrl ?? null,
                    timeout: 60,
                    max_retries: 2,
                    http_proxy: null,
                    default_params: {},
                    type: "chat" as const,
                    pricing: null,
                    output_dimension: null,
                    context_window: null,
                    max_tokens: null,
                    description: null,
                    knowledge_date: null,
                    provider: p?.name ?? null,
                    provider_id: d.provider_id,
                    is_local: false,
                    enabled: true,
                    created_at: undefined,
                    updated_at: undefined,
                    is_discovered: true,
                };
            });

        return ok([...dbModels, ...synthesized]);
    } catch (err) {
        return handle(err);
    }
}

interface CreateBody {
    name?: string;
    provider_id?: string;
    upstream_model_id?: string;
    type?: "chat" | "embedding" | "audio" | "reranker";
    default_params?: Record<string, unknown>;
    context_window?: number | null;
    max_tokens?: number | null;
    output_dimension?: number | null;
    pricing?: Record<string, unknown> | null;
    description?: string | null;
    knowledge_date?: string | null;
    timeout?: number;
    max_retries?: number;
    http_proxy?: Record<string, string> | null;
    enabled?: boolean;
}

export async function POST(req: NextRequest) {
    try {
        await ensureInit();
        await requireAdmin();
        const body = (await req.json()) as CreateBody;

        const name = body.name?.trim();
        const providerKey = body.provider_id?.trim();
        const upstream = body.upstream_model_id?.trim();
        if (!name) throw badRequest("Model name is required");
        if (!providerKey) throw badRequest("provider_id is required");
        if (!upstream) throw badRequest("upstream_model_id is required");

        const provider = findProviderByIdOrName(providerKey);
        if (!provider) throw badRequest("Provider not found");

        const existing = db.select().from(schema.models).where(eq(schema.models.name, name)).get();
        if (existing) throw badRequest("Model name already exists");

        const id = randomUUID();
        db.insert(schema.models).values({
            id,
            name,
            providerId: provider.id,
            upstreamModelId: upstream,
            type: body.type ?? "chat",
            defaultParams: body.default_params ?? {},
            contextWindow: body.context_window ?? null,
            maxTokens: body.max_tokens ?? null,
            outputDimension: body.output_dimension ?? null,
            pricing: body.pricing ?? null,
            description: body.description ?? null,
            knowledgeDate: body.knowledge_date ?? null,
            timeout: body.timeout ?? 60,
            maxRetries: body.max_retries ?? 2,
            httpProxy: body.http_proxy ?? null,
            enabled: body.enabled ?? true,
        }).run();

        const created = db.select().from(schema.models).where(eq(schema.models.id, id)).get()!;
        return ok(serializeModel(created, provider.name, provider.baseUrl));
    } catch (err) {
        return handle(err);
    }
}
