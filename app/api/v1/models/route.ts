import "server-only";
import { eq } from "drizzle-orm";
import { defineRoute } from "@/lib/server/route";
import { db, schema } from "@/lib/server/db";
import { listAllDiscovered } from "@/lib/server/discovery";

export const GET = defineRoute({
    auth: "gateway",
    handler: async () => {
        // 1) DB-defined overrides
        const rows = db.select().from(schema.models).where(eq(schema.models.enabled, true)).all();
        const seen = new Set<string>();
        const data = rows.map((m) => {
            seen.add(m.name);
            return {
                id: m.name,
                object: "model",
                created: Math.floor(new Date(m.createdAt).getTime() / 1000),
                owned_by: m.providerId,
                type: m.type,
            };
        });

        // 2) Live-discovered models from each enabled provider, deduped by name.
        const discovered = await listAllDiscovered();
        for (const m of discovered) {
            if (seen.has(m.id)) continue;
            seen.add(m.id);
            data.push({
                id: m.id,
                object: "model",
                created: 0,
                owned_by: m.meta.owned_by ?? m.provider_id,
                type: m.capability,
            });
        }

        return Response.json({ object: "list", data });
    },
});
