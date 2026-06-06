import "server-only";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/server/db";
import { ensureInit } from "@/lib/server/init";
import { requireAdmin, requireUser } from "@/lib/server/auth";
import { encryptSecret } from "@/lib/server/crypto";
import { badRequest, handle, notFound, ok } from "@/lib/server/response";
import { findProviderByIdOrName, modelCountsByProvider, serializeProvider } from "@/lib/server/serializers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    try {
        await ensureInit();
        await requireUser();
        const { id } = await ctx.params;
        const provider = findProviderByIdOrName(decodeURIComponent(id));
        if (!provider) throw notFound("Provider not found");
        const counts = modelCountsByProvider();
        return ok(serializeProvider(provider, counts[provider.id] ?? 0));
    } catch (err) {
        return handle(err);
    }
}

interface UpdateBody {
    name?: string;
    type?: "openai" | "azure";
    base_url?: string;
    api_version?: string | null;
    api_key?: string;
    default_params?: Record<string, unknown>;
    http_proxy?: Record<string, string> | null;
    document_page?: string;
    model_page?: string;
    is_local?: boolean;
    enabled?: boolean;
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    try {
        await ensureInit();
        await requireAdmin();
        const { id } = await ctx.params;
        const provider = findProviderByIdOrName(decodeURIComponent(id));
        if (!provider) throw notFound("Provider not found");

        const body = (await req.json()) as UpdateBody;
        const updates: Partial<typeof schema.providers.$inferInsert> = {};

        if (body.name !== undefined) {
            const newName = body.name.trim();
            if (!newName) throw badRequest("Provider name cannot be empty");
            if (newName !== provider.name) {
                const dup = db.select().from(schema.providers).where(eq(schema.providers.name, newName)).get();
                if (dup) throw badRequest("Provider name already exists");
                updates.name = newName;
            }
        }
        if (body.type !== undefined) {
            updates.type = body.type === "azure" ? "azure" : "openai";
        }
        if (body.base_url !== undefined) {
            if (!body.base_url.trim()) throw badRequest("base_url cannot be empty");
            updates.baseUrl = body.base_url.trim();
        }
        if (body.api_version !== undefined) {
            updates.apiVersion = body.api_version?.trim() || null;
        }
        if (body.api_key !== undefined) {
            updates.apiKeyEncrypted = body.api_key ? encryptSecret(body.api_key) : null;
        }
        if (body.default_params !== undefined) updates.defaultParams = body.default_params ?? {};
        if (body.http_proxy !== undefined) updates.httpProxy = body.http_proxy ?? null;
        if (body.document_page !== undefined) updates.documentPage = body.document_page;
        if (body.model_page !== undefined) updates.modelPage = body.model_page;
        if (body.is_local !== undefined) updates.isLocal = !!body.is_local;
        if (body.enabled !== undefined) updates.enabled = !!body.enabled;

        updates.updatedAt = new Date().toISOString();

        db.update(schema.providers).set(updates).where(eq(schema.providers.id, provider.id)).run();
        const reloaded = db.select().from(schema.providers).where(eq(schema.providers.id, provider.id)).get()!;
        const counts = modelCountsByProvider();
        return ok(serializeProvider(reloaded, counts[provider.id] ?? 0));
    } catch (err) {
        return handle(err);
    }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    try {
        await ensureInit();
        await requireAdmin();
        const { id } = await ctx.params;
        const provider = findProviderByIdOrName(decodeURIComponent(id));
        if (!provider) throw notFound("Provider not found");
        db.delete(schema.providers).where(eq(schema.providers.id, provider.id)).run();
        return ok(null);
    } catch (err) {
        return handle(err);
    }
}
