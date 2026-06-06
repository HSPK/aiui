import "server-only";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { ensureInit } from "@/lib/server/init";
import { authenticateGateway } from "@/lib/server/gateway";
import { db, schema } from "@/lib/server/db";
import { listAllDiscovered } from "@/lib/server/discovery";
import { handle } from "@/lib/server/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
    try {
        await ensureInit();
        await authenticateGateway(req);

        // 1) Static rows from the DB (admin-defined overrides / Azure deployments).
        const rows = db.select().from(schema.models).where(eq(schema.models.enabled, true)).all();
        const seen = new Set<string>();
        const data: Array<{
            id: string;
            object: string;
            created: number;
            owned_by: string;
            type?: string;
        }> = rows.map((m) => {
            seen.add(m.name);
            return {
                id: m.name,
                object: "model",
                created: Math.floor(new Date(m.createdAt).getTime() / 1000),
                owned_by: m.providerId,
                type: m.type,
            };
        });

        // 2) Live-discovered models from each enabled provider. Skip ids already
        //    surfaced by the DB so explicit overrides shadow the discovery.
        const discovered = await listAllDiscovered();
        for (const m of discovered) {
            if (seen.has(m.id)) continue;
            seen.add(m.id);
            data.push({
                id: m.id,
                object: "model",
                created: m.created ?? 0,
                owned_by: m.provider_id,
                type: m.capability,
            });
        }

        return Response.json({ object: "list", data });
    } catch (err) {
        return handle(err);
    }
}
