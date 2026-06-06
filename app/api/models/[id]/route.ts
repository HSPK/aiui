import "server-only";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/server/db";
import { ensureInit } from "@/lib/server/init";
import { requireAdmin, requireUser } from "@/lib/server/auth";
import { badRequest, handle, notFound, ok } from "@/lib/server/response";
import { findModelByIdOrName, findProviderByIdOrName, serializeModel } from "@/lib/server/serializers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    try {
        await ensureInit();
        await requireUser();
        const { id } = await ctx.params;
        const model = findModelByIdOrName(decodeURIComponent(id));
        if (!model) throw notFound("Model not found");
        const provider = db.select().from(schema.providers).where(eq(schema.providers.id, model.providerId)).get();
        return ok(serializeModel(model, provider?.name ?? null, provider?.baseUrl ?? null));
    } catch (err) {
        return handle(err);
    }
}

interface UpdateBody {
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

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    try {
        await ensureInit();
        await requireAdmin();
        const { id } = await ctx.params;
        const model = findModelByIdOrName(decodeURIComponent(id));
        if (!model) throw notFound("Model not found");

        const body = (await req.json()) as UpdateBody;
        const updates: Partial<typeof schema.models.$inferInsert> = {};

        if (body.name !== undefined) {
            const newName = body.name.trim();
            if (!newName) throw badRequest("Model name cannot be empty");
            if (newName !== model.name) {
                const dup = db.select().from(schema.models).where(eq(schema.models.name, newName)).get();
                if (dup) throw badRequest("Model name already exists");
                updates.name = newName;
            }
        }
        if (body.provider_id !== undefined) {
            const provider = findProviderByIdOrName(body.provider_id);
            if (!provider) throw badRequest("Provider not found");
            updates.providerId = provider.id;
        }
        if (body.upstream_model_id !== undefined) {
            if (!body.upstream_model_id.trim()) throw badRequest("upstream_model_id cannot be empty");
            updates.upstreamModelId = body.upstream_model_id.trim();
        }
        if (body.type !== undefined) updates.type = body.type;
        if (body.default_params !== undefined) updates.defaultParams = body.default_params ?? {};
        if (body.context_window !== undefined) updates.contextWindow = body.context_window;
        if (body.max_tokens !== undefined) updates.maxTokens = body.max_tokens;
        if (body.output_dimension !== undefined) updates.outputDimension = body.output_dimension;
        if (body.pricing !== undefined) updates.pricing = body.pricing;
        if (body.description !== undefined) updates.description = body.description;
        if (body.knowledge_date !== undefined) updates.knowledgeDate = body.knowledge_date;
        if (body.timeout !== undefined) updates.timeout = body.timeout;
        if (body.max_retries !== undefined) updates.maxRetries = body.max_retries;
        if (body.http_proxy !== undefined) updates.httpProxy = body.http_proxy ?? null;
        if (body.enabled !== undefined) updates.enabled = !!body.enabled;

        updates.updatedAt = new Date().toISOString();

        db.update(schema.models).set(updates).where(eq(schema.models.id, model.id)).run();
        const reloaded = db.select().from(schema.models).where(eq(schema.models.id, model.id)).get()!;
        const provider = db.select().from(schema.providers).where(eq(schema.providers.id, reloaded.providerId)).get();
        return ok(serializeModel(reloaded, provider?.name ?? null, provider?.baseUrl ?? null));
    } catch (err) {
        return handle(err);
    }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    try {
        await ensureInit();
        await requireAdmin();
        const { id } = await ctx.params;
        const model = findModelByIdOrName(decodeURIComponent(id));
        if (!model) throw notFound("Model not found");
        db.delete(schema.models).where(eq(schema.models.id, model.id)).run();
        return ok(null);
    } catch (err) {
        return handle(err);
    }
}
