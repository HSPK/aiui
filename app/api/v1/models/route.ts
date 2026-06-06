import "server-only";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { ensureInit } from "@/lib/server/init";
import { authenticateGateway } from "@/lib/server/gateway";
import { db, schema } from "@/lib/server/db";
import { handle } from "@/lib/server/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
    try {
        await ensureInit();
        await authenticateGateway(req);
        const rows = db.select().from(schema.models).where(eq(schema.models.enabled, true)).all();
        const data = rows.map((m) => ({
            id: m.name,
            object: "model",
            created: Math.floor(new Date(m.createdAt).getTime() / 1000),
            owned_by: m.providerId,
            type: m.type,
        }));
        return Response.json({ object: "list", data });
    } catch (err) {
        return handle(err);
    }
}
