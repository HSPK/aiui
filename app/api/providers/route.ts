import "server-only";
import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/server/db";
import { ensureInit } from "@/lib/server/init";
import { requireAdmin, requireUser } from "@/lib/server/auth";
import { encryptSecret } from "@/lib/server/crypto";
import { badRequest, handle, ok } from "@/lib/server/response";
import { modelCountsByProvider, serializeProvider } from "@/lib/server/serializers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
    try {
        await ensureInit();
        await requireUser();
        const rows = db.select().from(schema.providers).orderBy(schema.providers.name).all();
        const counts = modelCountsByProvider();
        return ok(rows.map((p) => serializeProvider(p, counts[p.id] ?? 0)));
    } catch (err) {
        return handle(err);
    }
}

interface CreateBody {
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

export async function POST(req: NextRequest) {
    try {
        await ensureInit();
        await requireAdmin();

        const body = (await req.json()) as CreateBody;
        const name = body.name?.trim();
        const baseUrl = body.base_url?.trim();
        const type = body.type === "azure" ? "azure" : "openai";
        if (!name) throw badRequest("Provider name is required");
        if (!baseUrl) throw badRequest("base_url is required");

        const existing = db.select().from(schema.providers).where(eq(schema.providers.name, name)).get();
        if (existing) throw badRequest("Provider name already exists");

        const id = randomUUID();
        db.insert(schema.providers).values({
            id,
            name,
            type,
            baseUrl,
            apiVersion: body.api_version?.trim() || null,
            apiKeyEncrypted: encryptSecret(body.api_key ?? null),
            defaultParams: body.default_params ?? {},
            httpProxy: body.http_proxy ?? null,
            documentPage: body.document_page ?? null,
            modelPage: body.model_page ?? null,
            isLocal: !!body.is_local,
            enabled: body.enabled ?? true,
        }).run();

        const created = db.select().from(schema.providers).where(eq(schema.providers.id, id)).get()!;
        return ok(serializeProvider(created, 0));
    } catch (err) {
        return handle(err);
    }
}
