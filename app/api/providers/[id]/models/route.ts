import "server-only";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/server/db";
import { ensureInit } from "@/lib/server/init";
import { requireUser } from "@/lib/server/auth";
import { discoverModels } from "@/lib/server/discovery";
import { handle, notFound, ok } from "@/lib/server/response";
import { findProviderByIdOrName, serializeModel } from "@/lib/server/serializers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    try {
        await ensureInit();
        await requireUser();
        const { id } = await ctx.params;
        const provider = findProviderByIdOrName(decodeURIComponent(id));
        if (!provider) throw notFound("Provider not found");

        // 1) DB-backed overrides for this provider.
        const dbRows = db.select().from(schema.models)
            .where(eq(schema.models.providerId, provider.id))
            .orderBy(schema.models.name)
            .all();
        const dbSerialized = dbRows.map((m) => ({
            ...serializeModel(m, provider.name, provider.baseUrl),
            is_discovered: false,
        }));
        const seen = new Set(dbSerialized.map((m) => m.name));

        // 2) Live-discovered models for THIS provider. Failures are tolerated
        //    — the page still shows DB rows if discovery errors out.
        let discovered: Awaited<ReturnType<typeof discoverModels>> = [];
        try {
            discovered = await discoverModels(provider);
        } catch (err) {
            console.warn(`[aiui] provider "${provider.name}" discovery failed:`, err);
        }
        const synthesized = discovered
            .filter((d) => !seen.has(d.id))
            .map((d) => ({
                id: `discovered:${provider.id}:${d.id}`,
                name: d.id,
                model_id: d.id,
                proxy: provider.baseUrl,
                timeout: 60,
                max_retries: 2,
                http_proxy: null,
                default_params: {},
                type: d.capability,
                pricing: null,
                output_dimension: null,
                context_window: null,
                max_tokens: null,
                description: null,
                knowledge_date: null,
                provider: provider.name,
                provider_id: provider.id,
                is_local: false,
                enabled: true,
                created_at: undefined,
                updated_at: undefined,
                is_discovered: true,
            }));

        return ok([...dbSerialized, ...synthesized]);
    } catch (err) {
        return handle(err);
    }
}
