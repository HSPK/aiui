import "server-only";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/server/db";
import { ensureInit } from "@/lib/server/init";
import { requireUser } from "@/lib/server/auth";
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

        const rows = db.select().from(schema.models).where(eq(schema.models.providerId, provider.id)).orderBy(schema.models.name).all();
        return ok(rows.map((m) => serializeModel(m, provider.name, provider.baseUrl)));
    } catch (err) {
        return handle(err);
    }
}
